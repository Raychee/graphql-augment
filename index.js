const {SchemaDirectiveVisitor, UserInputError} = require('graphql-tools');
const {
    isInputType, getNamedType, getNullableType,
    GraphQLBoolean, GraphQLInt, GraphQLFloat, GraphQLString, GraphQLID, GraphQLList, GraphQLNonNull,
    GraphQLInputObjectType, GraphQLObjectType,
} = require('graphql');
const {GraphQLDateTime} = require('graphql-iso-date');


function getEligibleOperators(type) {
    const operators = ['is'];
    if (type.name !== GraphQLBoolean.name) {
        operators.push('not', 'in', 'not_in');
    }
    if ([GraphQLFloat, GraphQLInt, GraphQLString, GraphQLID, GraphQLDateTime].map(t => t.name).indexOf(type.name) >= 0) {
        operators.push('gt', 'gte', 'lt', 'lte');
    }
    if ([GraphQLString, GraphQLID].map(t => t.name).indexOf(type.name) >= 0) {
        operators.push('contains', 'not_contains', 'starts_with', 'not_starts_with', 'ends_with', 'not_ends_with');
    }
    return operators;
}

function ensureFilterInputType(schema, typeName) {
    const filterInputTypeName = `${typeName}FilterInput`;
    let filterInputType = schema.getType(filterInputTypeName);
    if (!filterInputType) {
        filterInputType = new GraphQLInputObjectType({
            name: filterInputTypeName,
            fields: {}
        });
        filterInputType._augmentType = 'filter.type';
        filterInputType._augmentedTypeName = typeName;
        schema.getTypeMap()[filterInputTypeName] = filterInputType;
    }
    return filterInputType;
}

function ensureInputType(schema, typeName) {
    const inputTypeName = `${typeName}Input`;
    let inputType = schema.getType(inputTypeName);
    if (!inputType) {
        inputType = new GraphQLInputObjectType({
            name: inputTypeName,
            fields: {}
        });
        inputType._augmentType = 'input.type';
        inputType._augmentedTypeName = typeName;
        schema.getTypeMap()[inputTypeName] = inputType;
    }
    return inputType;
}

function forEachAugmentedArg(args, info, callback) {

    function _forEachAugmentedArg(fieldPath, args, typeName, isQuery, extra) {
        let schemaArgs;
        if (isQuery) {
            let type = info.schema.getQueryType().getFields()[typeName];
            if (!type) {
                const mutationType = info.schema.getMutationType();
                if (!mutationType) {
                    return;
                }
                type = mutationType.getFields()[typeName];
            }
            if (!type) {
                return;
            }
            schemaArgs = type.args;
        } else {
            schemaArgs = Object.values(info.schema.getType(typeName).getFields());
        }
        for (const schemaArg of schemaArgs) {
            let fieldPathExtended;
            switch (schemaArg._augmentType) {
                case "filter.operator":
                    if (schemaArg.name in args) {
                        fieldPathExtended = fieldPath.slice();
                        fieldPathExtended.push(schemaArg._augmentedField);
                        callback(fieldPathExtended, {
                            operator: schemaArg._augmentedOperator,
                            value: args[schemaArg.name],
                        });
                    }
                    break;
                case "filter.nested":
                    if (typeof args[schemaArg.name] === 'object') {
                        fieldPathExtended = fieldPath.slice();
                        fieldPathExtended.push(schemaArg._augmentedField);
                        _forEachAugmentedArg(fieldPathExtended, args[schemaArg.name], schemaArg.type.name, false);
                    }
                    break;
                case "filter.filter":
                    if (typeof args[schemaArg.name] === 'object') {
                        _forEachAugmentedArg(fieldPath, args, schemaArg.type.name, false);
                    }
                    break;
                case "filter.pagination":
                    if (schemaArg.name in args) {
                        callback(fieldPath, {[schemaArg.name]: args[schemaArg.name]});
                    }
                    break;
                case "sort.sort":
                    if (schemaArg.name in args) {
                        callback(fieldPath, {[schemaArg.name]: args[schemaArg.name]});
                    }
                    break;
                case "input.field":
                    if (schemaArg.name in args) {
                        fieldPathExtended = fieldPath.slice();
                        fieldPathExtended.push(schemaArg._augmentedField);
                        callback(fieldPathExtended, Object.assign({}, extra, {value: args[schemaArg.name]}));
                    }
                    break;
                case "input.inputs":
                    if (Array.isArray(args[schemaArg.name])) {
                        let i = 0;
                        const subTypeName = getNamedType(schemaArg.type).name;
                        for (const arg of args[schemaArg.name]) {
                            _forEachAugmentedArg(fieldPath, arg, subTypeName, false, {index: i++});
                        }
                    }
                    break;
            }
        }
    }

    _forEachAugmentedArg([], args, info.fieldName, true);

}


class AugmentedArgResolver {

    constructor(resolvers) {
        this.resolvers = resolvers;
    }

    async resolve(args, info) {
        return await this._resolve(args, info, info.fieldName,0);
    }

    async _resolve(args, info, typeName, depth, context) {
        let augmentedSchemaArgs;
        if (depth <= 0) {
            let type;
            if (typeName.startsWith('Update')) {
                const mutationType = info.schema.getMutationType();
                if (!mutationType) {
                    throw new UserInputError(`mutation type "${typeName}" is not valid`);
                }
                type = mutationType.getFields()[typeName];
                if (!type) {
                    throw new UserInputError(`mutation type "${typeName}" are not valid`);
                }
                typeName = typeName.slice(6);
            } else {
                const queryType = info.schema.getQueryType();
                if (!queryType) {
                    throw new UserInputError(`query type "${typeName}" is not valid`);
                }
                type = info.schema.getQueryType().getFields()[typeName];
                if (!type) {
                    throw new UserInputError(`query type "${typeName}" are not valid`);
                }
            }
            augmentedSchemaArgs = type.args;
        } else {
            const type = info.schema.getType(typeName);
            if (type._augmentedTypeName) {
                typeName = type._augmentedTypeName;
            }
            augmentedSchemaArgs = Object.values(type.getFields());
        }
        const resolvers = this.resolvers[typeName];
        let ctx = context === undefined ?  await resolvers.init() : context;
        let ctxs = [];
        let pagination = {};
        for (const augmentedArg of augmentedSchemaArgs) {
            switch (augmentedArg._augmentType) {
                case "filter.operator":
                    if (augmentedArg.name in args && resolvers.filter) {
                        ctx = await resolvers.filter(ctx,
                            augmentedArg._augmentedField, augmentedArg._augmentedOperator, args[augmentedArg.name]
                        ) || ctx;
                    }
                    break;
                case "filter.nested":
                    if (typeof args[augmentedArg.name] === 'object' && resolvers.nested) {
                        ctx = await resolvers.nested(ctx,
                            augmentedArg._augmentedField, await this._resolve(
                                args[augmentedArg.name], info, augmentedArg.type.name, depth + 1
                            )
                        ) || ctx;
                    }
                    break;
                case "filter.filter":
                    if (typeof args[augmentedArg.name] === 'object' && augmentedArg.type.name === typeName) {
                        ctx = await this._resolve(args, info, typeName, depth, ctx);
                    }
                    break;
                case "filter.pagination":
                    if (augmentedArg.name in args) {
                        pagination[augmentedArg.name] = args[augmentedArg.name];
                    }
                    break;
                case "sort.sort":
                    if (augmentedArg.name in args && resolvers.sort) {
                        ctx = await resolvers.sort(ctx, args[augmentedArg.name]) || ctx;
                    }
                    break;
                case "input.field":
                    if (augmentedArg.name in args && resolvers.input) {
                        ctx = await resolvers.input(ctx, augmentedArg._augmentedField, args[augmentedArg.name]) || ctx;
                    }
                    break;
                case "input.nested":
                    if (typeof args[augmentedArg.name] === 'object' && resolvers.nested) {
                        ctx = await resolvers.nested(ctx,
                            augmentedArg._augmentedField, await this._resolve(
                                args[augmentedArg.name], info, augmentedArg.type.name, depth + 1
                            )
                        ) || ctx;
                    }
                    break;
                case "input.inputs":
                    if (Array.isArray(args[augmentedArg.name]) && depth === 0) {
                        let i = 0;
                        const subTypeName = getNamedType(augmentedArg.type).name;
                        for (const arg of args[augmentedArg.name]) {
                            let ictx = await resolvers.init();
                            ictx = await this._resolve(arg, info, subTypeName, depth + 1, ictx);
                            ctxs.push(ictx);
                        }
                    }
                    break;
                default:
                    if (augmentedArg.name in args && resolvers.others) {
                        ctx = await resolvers.others(ctx, augmentedArg.name, args[augmentedArg.name]) || ctx;
                    }
                    break;
            }
        }
        if (Object.keys(pagination).length > 0 && resolvers.paginate) {
            const {limit, offset} = pagination;
            ctx = await resolvers.paginate(ctx, limit, offset) || ctx;
        }
        if (context !== undefined) {
            return ctx;
        }
        if (ctxs.length > 0 && resolvers.returnBatch) {
            ctxs.unshift(ctx);
            return await resolvers.returnBatch(ctxs);
        }
        if (depth > 0) {
            return await resolvers.resolve(ctx);
        } else {
            return await resolvers.return(ctx);
        }
    }

}


class Sortable extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        if (details.objectType !== this.schema.getQueryType()) {
            throw new Error('directive "Paginated" should only be used on root query field definitions');
        }
        if (!this.schema.getType(field.name)) {
            throw new Error(`directive "Paginated" used on field "${field.name}" which does not match any of the existing types`);
        }
        const existingArgs = new Set(field.args.map(a => a.name));
        const sortArgName = 'sort';
        const sortInputTypeName = 'sortInput';

        if (!existingArgs.has(sortArgName)) {
            let sortInputType = this.schema.getType(sortInputTypeName);
            if (!sortInputType) {
                sortInputType = new GraphQLInputObjectType({
                    name: sortInputTypeName,
                    fields: {
                        by: {type: new GraphQLNonNull(GraphQLString)},
                        desc: {type: GraphQLBoolean, defaultValue: false}
                    }
                });
                sortInputType._augmentType = 'sort.inputType';
                this.schema.getTypeMap()[sortInputTypeName] = sortInputType;
            } else if (!sortInputType._augmentType) {
                return;
            }
            field.args.push({
                name: sortArgName, type: new GraphQLList(new GraphQLNonNull(sortInputType)), _augmentType: 'sort.sort'
            });
        }
    }

}


class Pageable extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        if (details.objectType !== this.schema.getQueryType()) {
            throw new Error('directive "Paginated" should only be used on root query field definitions');
        }
        if (!this.schema.getType(field.name)) {
            throw new Error(`directive "Paginated" used on field "${field.name}" which does not match any of the existing types`);
        }
        const existingArgs = new Set(field.args.map(a => a.name));
        for (const paginationArg of ['limit', 'offset']) {
            if (!existingArgs.has(paginationArg)) {
                field.args.push({
                    name: paginationArg, type: GraphQLInt, _augmentType: 'filter.pagination',
                });
            }
        }
    }

}


class BatchInputs extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        if (details.objectType !== this.schema.getMutationType()) {
            throw new Error('directive "BatchInput" should only be used on root mutation field definitions');
        }
        if (!field.name.startsWith('Update')) {
            throw new Error('directive "BatchInput" should only be used on fields that starts with "Update..."');
        }
        const typeName = field.name.slice(6);
        if (!this.schema.getType(typeName)) {
            throw new Error(`directive "BatchInput" used on field "${field.name}" but "${typeName}" does not match any of the existing types`);
        }
        if (field.args.every(a => a.name !== 'inputs')) {
            field.args.push({
                name: 'inputs',
                type: new GraphQLList(new GraphQLNonNull(ensureInputType(this.schema, typeName))),
                _augmentType: 'input.inputs'
            })
        }
    }

}

class Filterable extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        const filterInputType = ensureFilterInputType(this.schema, details.objectType.name);
        const filterInputTypeFields = filterInputType.getFields();
        const fieldType = getNamedType(field.type);
        const augments = [];
        if (isInputType(fieldType)) {
            const operators = getEligibleOperators(fieldType);
            for (const operator of operators) {
                const filterInputTypeFieldName = operator === 'is' ?
                    field.name : `${field.name}_${operator}`;
                const inputTypeFieldType = ['in', 'not_in'].indexOf(operator) >= 0 ?
                    new GraphQLList(fieldType) : fieldType;
                augments.push({
                    name: filterInputTypeFieldName,
                    type: inputTypeFieldType,
                    _augmentType: 'filter.operator', _augmentedField: field.name, _augmentedOperator: operator
                });
            }
        } else if ((fieldType instanceof GraphQLObjectType)) {
            augments.push({
                name: field.name,
                type: ensureFilterInputType(this.schema, fieldType.name),
                _augmentType: 'filter.nested', _augmentedField: field.name
            });
        }
        for (const augment of augments) {
            filterInputTypeFields[augment.name] = augment;
        }
        const queryField = this.schema.getQueryType().getFields()[details.objectType.name];
        if (!queryField) {
            return;
        }
        if (queryField.args.every(a => a.name !== 'filter')) {
            queryField.args.push({name: 'filter', type: filterInputType, _augmentType: 'filter.filter'});
        }
        for (const augment of augments) {
            queryField.args.push(augment);
        }
    }

}

class Inputable extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        const inputTypeFields = ensureInputType(this.schema, details.objectType.name).getFields();
        const fieldType = getNamedType(field.type);
        let augment;
        if (isInputType(fieldType)) {
            augment = {
                name: field.name,
                type: getNullableType(field.type),
                description: field.description,
                _augmentType: 'input.field',
                _augmentedField: field.name
            };
        } else if ((fieldType instanceof GraphQLObjectType)) {
            augment = {
                name: field.name,
                type: ensureInputType(this.schema, fieldType.name),
                description: field.description,
                _augmentType: 'input.nested',
                _augmentedField: field.name
            };
        }
        if (augment) {
            inputTypeFields[augment.name] = augment;
        }
        let mutationType = this.schema.getMutationType();
        if (!mutationType) {
            return;
        }
        const mutationName = `Update${details.objectType.name}`;
        let mutationField = mutationType.getFields()[mutationName];
        if (!mutationField) {
            return;
        }
        mutationField.args.push(augment);
    }

}


module.exports = {
    forEachAugmentedArg,
    AugmentedArgResolver,

    schemaDirectives: {
        sortable: Sortable,
        pageable: Pageable,
        batchInputs: BatchInputs,
        filterable: Filterable,
        inputable: Inputable,
    }
};