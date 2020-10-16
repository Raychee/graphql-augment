const debug = require('debug')('graphql-augment:directives/common');
const {
    isInputType, getNamedType, defaultFieldResolver,
    GraphQLBoolean, GraphQLString, GraphQLInt,
    GraphQLInputObjectType, GraphQLObjectType, GraphQLList, GraphQLNonNull,
} = require('graphql');
const {GraphQLJSONObject} = require('graphql-type-json');
const {SchemaDirectiveVisitor} = require('graphql-tools');
const {
    capitalize, typeToString, wrapNonNullAndListType, isRootType,
    applyOnTarget, ensureApplyOnTarget,
    applyOnRootTypeFieldByTypeMode,
    augmentFieldArgs, augmentTypeField, augmentInputTypeField, ResponseResolver,
} = require("../utils");
const config = require('../config');


const DIRECTIVE_ARGS_ON_ROOT_TYPE = {
    type: true,
    response: true,
    cursor: true,
    batchArgs: true,
    sort: true,
    page: true,
    pageSize: true,
}

const DIRECTIVE_ARGS_ON_TYPE = {
    as: true,
    args: true,
    argsAs: true,
    op: true,
    opInclude: true,
    opExclude: true,
    key: true,
    required: true,
    result: true,
    resultAs: true,
    resultArgs: true,
    batchArgs: true,
    sort: true,
    page: true,
    pageSize: true,
};


class SchemaAugmenter extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {

        const mode = this.getAugmentMode();
        this.validateDirectiveArgs();

        if (isRootType(details.objectType, this.schema)) {

            if (field._augmentedTarget) {
                throw new Error(
                    `@${mode} conflicts with @${field._augmentedTarget.mode} ` +
                    `on root query / mutation field "${field.name}"`
                );
            }
            if (!this.args.type) {
                throw new Error(`@${mode}(type: ...) is required on root query / mutation fields`);
            }
            field._augmentedTarget = {mode, ...this.args};

            if (this.args.response && field.type._augmentType !== 'result.response') {
                const responseType = this.ensureResponseType(field.type);
                debug(
                    '@%s on %s.%s: ensure response type for %s -> %s', mode, details.objectType.name,
                    field.name, getNamedType(field.type).name, responseType.name
                );
                field.type = GraphQLNonNull(responseType);
                if (this.args.cursor) {
                    debug('@%s on %s.%s: ensure arg cursor', mode, details.objectType.name, field.name);
                    augmentFieldArgs(field, [{
                        name: config.ARG_NAME_CURSOR,
                        type: GraphQLString,
                        _augmentType: 'cursor.cursor',
                    }]);
                }
            }

            if (this.args.batchArgs) {
                this.augmentBatchForField(field, details, field, this.args.type, mode);
            }
            if (this.args.sort) {
                this.augmentSortForField(field, details, field);
            }
            if (this.args.page) {
                this.augmentPageForField(field, details, field);
            }

            ensureApplyOnTarget(this.schema);

        } else {

            if (this.args.result) {
                const resultMode = this.args.resultAs || this.args.as || mode;
                const resultType = this.ensureResultType(details.objectType);
                debug(
                    '@%s on %s.%s: ensure result type for %s -> %s', mode,
                    details.objectType.name, field.name, details.objectType.name, resultType.name
                );
                applyOnRootTypeFieldByTypeMode(
                    this.schema, details.objectType.name, mode,
                    (queryField) => {
                        let queryFieldType = getNamedType(queryField.type);
                        if (queryFieldType._augmentType === 'result.response') {
                            queryField = queryFieldType.getFields()[config.FIELD_NAME_RESULTS];
                            queryFieldType = getNamedType(queryField.type);
                        }
                        if (queryFieldType._augmentType !== 'type.result') {
                            const replacedType = wrapNonNullAndListType(resultType, queryField.type)
                            debug(
                                '@%s on %s.%s (delayed): replace return type %s -> %s on (Query/Mutation).%s',
                                mode, details.objectType.name, field.name,
                                typeToString(queryField.type), typeToString(replacedType), queryField.name,
                            )
                            queryField.type = replacedType;
                        }
                    }
                );
                const augment = {
                    name: field.name,
                    description: field.description,
                    ...(field.args ? {args: field.args} : {}),
                };
                const fieldType = getNamedType(field.type);
                if (isInputType(fieldType)) {
                    augment.type = field.type;
                } else if (fieldType instanceof GraphQLObjectType) {
                    const augType = this.ensureResultType(fieldType, resultMode, this.schema);
                    debug(
                        '@%s on %s.%s: ensure result type for %s -> %s', mode,
                        details.objectType.name, field.name, fieldType.name, augType.name
                    );
                    augment.type = wrapNonNullAndListType(augType, field.type);
                } else {
                    throw new Error(
                        `field ${details.objectType.name}.${field.name} cannot be processed ` +
                        `by @${mode}(${[
                            this.args.result ? `result: ${this.args.result}` : '',
                            this.args.resultAs ? `resultAs: ${this.args.resultAs}` : '',
                            this.args.as ? `as: ${this.args.as}` : '',
                        ].filter(v => v).join(', ')})`
                    );
                }
                debug(
                    '@%s on %s.%s: augment type field %s.%s: %s', mode,
                    details.objectType.name, field.name,
                    resultType.name, field.name, typeToString(augment.type)
                );
                const resultTypeField = augmentTypeField(resultType, augment, this.schema);


                if (this.args.batchArgs) {
                    this.augmentBatchForField(field, details, resultTypeField, details.objectType.name, resultMode);
                }
                if (this.args.sort) {
                    this.augmentSortForField(field, details, resultTypeField);
                }

                if (this.args.page) {
                    this.augmentPageForField(field, details, resultTypeField);
                }

            }

            if (!field._augmentedTargetsByMode) {
                field._augmentedTargetsByMode = {};
            }
            field._augmentedTargetsByMode[mode] = this.args;

            if (this.args.args) {
                const augments = this.getFieldAugments(field, details);
                if (augments.length > 0) {
                    const inputType = this.ensureInputType(details.objectType.name);
                    debug(
                        '@%s on %s.%s: ensure input type %s -> %s', mode,
                        details.objectType.name, field.name, details.objectType.name, inputType.name
                    );
                    const inputTypeFields = inputType.getFields();
                    for (const augment of augments) {
                        if (!(augment.name in inputTypeFields)) {
                            debug(
                                '@%s on %s.%s: augment type field %s.%s: %s', mode,
                                details.objectType.name, field.name, inputType.name, augment.name
                            );
                            augmentInputTypeField(inputType, augment);
                        }
                    }
                    applyOnRootTypeFieldByTypeMode(
                        this.schema, details.objectType.name, mode,
                        (queryField) => augmentFieldArgs(queryField, augments)
                    );
                    for (const type of Object.values(this.schema.getTypeMap())) {
                        if (!(type instanceof GraphQLObjectType)) continue;
                        if (isRootType(type, this.schema)) continue;
                        for (const typeField of Object.values(type.getFields())) {
                            if (getNamedType(typeField.type).name !== details.objectType.name) continue;
                            applyOnTarget(
                                typeField,
                                (modes) => {
                                    for (const mode_ of modes) {
                                        const resultType = this.ensureResultType(type, mode_);
                                        debug(
                                            '@%s on %s.%s (delayed): ensure result type for %s -> %s ' +
                                            'and apply arg augments for %s.%s',
                                            mode, details.objectType.name, field.name,
                                            type.name, resultType.name, resultType.name, typeField.name
                                        );
                                        const resultTypeField = resultType.getFields()[typeField.name];
                                        if (resultTypeField) {
                                            augmentFieldArgs(resultTypeField, augments);
                                        }
                                    }
                                    return true;
                                },
                                () => {
                                    const modes = Object.entries(typeField._augmentedTargetsByMode || {})
                                        .filter(([mode_, args]) => {
                                            if (!args.resultArgs) return false;
                                            return (args.resultAs || args.as || mode_) === mode;
                                        })
                                        .map(([mode_]) => mode_);
                                    if (modes.length > 0) return modes;
                                }
                            )
                        }
                    }
                }
            }

            ensureApplyOnTarget(field);

        }

    }

    validateDirectiveArgs() {
        const mode = this.getAugmentMode();
        for (const argName of Object.keys(this.args)) {
            if (!DIRECTIVE_ARGS_ON_ROOT_TYPE[argName] && !DIRECTIVE_ARGS_ON_TYPE[argName]) {
                throw new Error(`@${mode}(${argName}: ...) is unknown`);
            }
        }
    }

    ensureType(typeName, typeFn) {
        let type = this.schema.getType(typeName);
        if (!type) {
            type = typeFn(typeName);
            this.schema.getTypeMap()[typeName] = type;
        }
        return type;
    }

    ensureInputType(typeName, mode) {
        mode = mode || this.getAugmentMode();
        const inputType = this.ensureType(
            `${typeName}${capitalize(mode)}Input`,
            (inputTypeName) => new GraphQLInputObjectType({
                name: inputTypeName,
                fields: {}
            })
        );
        inputType._augmentType = 'type.input';
        inputType._augmentedTypeName = typeName;
        inputType._augmentedMode = mode;
        return inputType;
    }

    ensureResultType(type, mode) {
        mode = mode || this.getAugmentMode();
        const resultType = this.ensureType(
            `${type.name}${capitalize(mode)}${capitalize(config.MODE_RESULT)}`,
            (resultTypeName) => new GraphQLObjectType({
                name: resultTypeName,
                fields: {},
                description: type.description,
            })
        );
        resultType._augmentType = 'type.result';
        resultType._augmentedTypeName = type.name;
        resultType._augmentedMode = mode;
        return resultType;
    }

    ensureResponseType(fieldType, mode) {
        mode = mode || this.getAugmentMode();
        const typeName = getNamedType(fieldType).name;
        return this.ensureType(
            `${typeName}${capitalize(mode)}${this.args.cursor ? 'Tailable' : ''}Response`,
            (responseTypeName) => {
                const responseType = new GraphQLObjectType({
                    name: responseTypeName,
                    fields: {
                        [config.FIELD_NAME_RESULTS]: {
                            type: fieldType,
                            async resolve(arg, ...args) {
                                if (arg instanceof ResponseResolver) {
                                    return await arg.getResults();
                                } else {
                                    return defaultFieldResolver.call(this, arg, ...args);
                                }
                            }
                        },
                        ...(this.args.cursor ? {
                            [config.FIELD_NAME_CURSOR]: {
                                type: GraphQLString,
                                async resolve(arg, ...args) {
                                    if (arg instanceof ResponseResolver) {
                                        return await arg.getCursor();
                                    } else {
                                        return defaultFieldResolver.call(this, arg, ...args);
                                    }
                                }
                            }
                        } : {}),
                        [config.FIELD_NAME_COUNT]: {
                            type: GraphQLInt,
                            async resolve(arg, ...args) {
                                if (arg instanceof ResponseResolver) {
                                    return await arg.getCount();
                                } else {
                                    return defaultFieldResolver.call(this, arg, ...args);
                                }
                            }
                        },
                        [config.FIELD_NAME_DEBUG]: {
                            type: GraphQLJSONObject,
                            async resolve(arg, ...args) {
                                if (arg instanceof ResponseResolver) {
                                    return await arg.getDebugInfo();
                                } else {
                                    return defaultFieldResolver.call(this, arg, ...args);
                                }
                            }
                        },
                    }
                });
                responseType._augmentType = 'result.response';
                responseType._augmentedTypeName = typeName;
                responseType._augmentedMode = mode;
                return responseType;
            }
        );

    }

    augmentBatchForField(field, details, targetField, typeName, batchMode) {
        const inputType = this.ensureInputType(typeName, batchMode);
        debug(
            '@%s on %s.%s: augment arg %s.%s(%s: [%s!])', this.getAugmentMode(),
            details.objectType.name, field.name,
            details.objectType.name, targetField.name, this.getArgNameForBatch(), inputType.name
        );
        augmentFieldArgs(targetField, [{
            name: this.getArgNameForBatch(),
            type: GraphQLList(GraphQLNonNull(inputType)),
            _augmentType: this.getAugmentTypeForBatch(),
        }]);
    }

    augmentSortForField(field, details, targetField) {
        const sortInputTypeName = `${capitalize(config.ARG_NAME_SORT)}Input`;
        const sortInputType = this.ensureType(sortInputTypeName, () => {
            const sortInputType = new GraphQLInputObjectType({
                name: sortInputTypeName,
                fields: {
                    by: {type: GraphQLNonNull(GraphQLString), description: '需要排序的字段'},
                    desc: {type: GraphQLBoolean, defaultValue: false, description: '降序为true，默认为false'}
                }
            });
            sortInputType._augmentType = 'sort.inputType';
            return sortInputType;
        });
        debug(
            '@%s on %s.%s: augment arg %s.%s(%s: [%s!])', this.getAugmentMode(),
            details.objectType.name, field.name,
            details.objectType.name, targetField.name, this.getArgNameForSort(), sortInputTypeName
        );
        augmentFieldArgs(targetField, [{
            name: this.getArgNameForSort(),
            type: GraphQLList(GraphQLNonNull(sortInputType)),
            _augmentType: 'sort.sort'
        }]);
    }

    augmentPageForField(field, details, targetField) {
        debug(
            '@%s on %s.%s: augment arg %s.%s(%s: %s) and %s.%s(%s: %s)', this.getAugmentMode(),
            details.objectType.name, field.name,
            details.objectType.name, targetField.name, config.ARG_NAME_PAGE, GraphQLInt.name,
            details.objectType.name, targetField.name, config.ARG_NAME_PAGESIZE, GraphQLInt.name,
        );
        augmentFieldArgs(targetField, [
            {
                name: config.ARG_NAME_PAGE,
                type: GraphQLInt,
                defaultValue: 1,
                _augmentType: 'filter.pagination',
            },
            {
                name: config.ARG_NAME_PAGESIZE,
                type: GraphQLInt,
                ...(this.args.pageSize > 0 ? {defaultValue: this.args.pageSize} : {}),
                _augmentType: 'filter.pagination',
            },
        ]);
    }

    getAugmentMode() {
        return '';
    }

    getFieldAugments() {
        return [];
    }

    getArgNameForBatch() {
        return '';
    }

    getAugmentTypeForBatch() {
        return '';
    }

    getArgNameForSort() {
        return config.ARG_NAME_SORT;
    }

    getArgNameForPage() {
        return config.ARG_NAME_PAGE;
    }

    getArgNameForPageSize() {
        return config.ARG_NAME_PAGESIZE;
    }

}


module.exports = {
    SchemaAugmenter,
};
