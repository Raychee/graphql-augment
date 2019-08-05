const {SchemaDirectiveVisitor, UserInputError} = require('graphql-tools');
const {
    isInputType, getNamedType, getNullableType,
    GraphQLBoolean, GraphQLInt, GraphQLFloat, GraphQLString, GraphQLID, GraphQLList, GraphQLNonNull,
    GraphQLInputObjectType, GraphQLObjectType,
} = require('graphql');
const {GraphQLDateTime} = require('graphql-iso-date');
const {GraphQLJSON, GraphQLJSONObject} = require('graphql-type-json');


const ARG_NAME_SORT = 'sort';
const ARG_NAME_LIMIT = 'limit';
const ARG_NAME_OFFSET = 'offset';
const ARG_NAME_PAGE = 'page';
const ARG_NAME_PAGESIZE = 'pageSize';


function getEligibleOperators(type) {
    const operators = ['is'];
    if ([GraphQLBoolean, GraphQLJSONObject].map(t => t.name).indexOf(type.name) < 0) {
        operators.push('not', 'in', 'not_in');
    }
    if ([GraphQLFloat, GraphQLInt, GraphQLString, GraphQLID, GraphQLDateTime].map(t => t.name).indexOf(type.name) >= 0) {
        operators.push('gt', 'gte', 'lt', 'lte');
    }
    if ([GraphQLString, GraphQLID].map(t => t.name).indexOf(type.name) >= 0) {
        operators.push('regex', 'not_regex');
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

function ensureResultType(schema, fieldType) {
    const typeName = getNamedType(fieldType).name;
    const resultTypeName = `${typeName}Result`;
    let resultType = schema.getType(resultTypeName);
    if (!resultType) {
        resultType = new GraphQLObjectType({
            name: resultTypeName,
            fields: {
                results: {
                    type: fieldType,
                    async resolve(parent) {
                        return await parent.getResults();
                    }
                },
                count: {
                    type: GraphQLInt,
                    async resolve(parent) {
                        return await parent.getCount();
                    }
                },
            }
        });
        resultType._augmentType = 'result.type';
        resultType._augmentedTypeName = typeName;
        schema.getTypeMap()[resultTypeName] = resultType;
    }
    return resultType;
}


class AugmentedArgResolver {

    constructor(resolvers, options) {
        this.resolvers = resolvers;
        const {depthFirst} = options || {};
        this.depthFirst = depthFirst || false;
    }

    async resolve(args, infoOrSchema, fieldName) {
        if (fieldName) {
            return await this._resolve(args, fieldName, infoOrSchema);
        } else {
            return await this._resolve(args, infoOrSchema.fieldName, infoOrSchema.schema);
        }
    }

    async _resolve(args, typeName, schema, parentContext, existingContext) {
        let augmentedSchemaArgs;
        let augmentedResultType;
        if (parentContext) {
            const type = schema.getType(typeName);
            if (!type) {
                throw new UserInputError(`type "${typeName}" is not valid`);
            }
            if (type._augmentedTypeName) {
                typeName = type._augmentedTypeName;
            }
            augmentedSchemaArgs = Object.values(type.getFields());
        } else {
            if (typeName.startsWith('Update')) {
                const mutationType = schema.getMutationType();
                let field;
                if (mutationType) {
                    field = mutationType.getFields()[typeName];
                }
                if (!field) {
                    throw new UserInputError(`mutation type "${typeName}" is not valid`);
                }
                augmentedSchemaArgs = field.args;
                typeName = typeName.slice(6);
            } else {
                const queryType = schema.getQueryType();
                let field;
                if (queryType) {
                    field = queryType.getFields()[typeName];
                }
                if (field) {
                    augmentedSchemaArgs = field.args;
                    if (field.type._augmentType === 'result.type') {
                        augmentedResultType = field.type;
                    }
                } else {
                    const type = schema.getType(typeName);
                    if (!type) {
                        throw new UserInputError(`type "${typeName}" is not valid`);
                    }
                    if (type._augmentedTypeName) {
                        typeName = type._augmentedTypeName;
                    }
                    augmentedSchemaArgs = Object.values(type.getFields());
                }
            }
        }
        const resolvers = this.resolvers[typeName];
        let ctx = existingContext ? existingContext : await resolvers.init(parentContext);
        let extra = {};
        let ctxs = [];
        let processed = false;
        const plain = [];
        const nested = [];
        for (const augmentedArg of augmentedSchemaArgs) {
            if (['filter.nested', 'input.nested'].indexOf(augmentedArg._augmentType) >= 0) {
                nested.push({augmentedArg, argValue: args[augmentedArg.name]});
            } else {
                plain.push({augmentedArg, argValue: args[augmentedArg.name]});
            }
        }
        const process = [];
        if (this.depthFirst) {
            process.push.apply(process, nested);
            process.push.apply(process, plain);
        } else {
            process.push.apply(process, plain);
            process.push.apply(process, nested);
        }
        for (const {augmentedArg, argValue} of process) {
            switch (augmentedArg._augmentType) {
                case "filter.operator":
                    if (augmentedArg.name in args && resolvers.filter) {
                        ctx = await resolvers.filter(ctx,
                            augmentedArg._augmentedField, augmentedArg._augmentedOperator, argValue,
                            getNullableType(schema.getType(typeName).getFields(augmentedArg._augmentedField).type) instanceof GraphQLList
                        ) || ctx;
                        processed = true;
                    }
                    break;
                case "filter.nested":
                    if (typeof argValue === 'object' && resolvers.nested) {
                        ctx = await resolvers.nested(ctx,
                            augmentedArg._augmentedField,
                            await this._resolve(argValue, augmentedArg.type.name, schema, ctx),
                            augmentedArg.type._augmentedTypeName || augmentedArg.type.name
                        ) || ctx;
                        processed = true;
                    }
                    break;
                case "filter.filters":
                    if (Array.isArray(argValue)) {
                        const subTypeName = getNamedType(augmentedArg.type).name;
                        for (const arg of argValue) {
                            let ictx = await resolvers.init(parentContext);
                            ictx = await this._resolve(arg, subTypeName, schema, parentContext, ictx);
                            ctxs.push(ictx);
                        }
                    }
                    break;
                case "filter.pagination":
                    if (augmentedArg.name in args) {
                        extra[augmentedArg.name] = argValue;
                    }
                    break;
                case "sort.sort":
                    if (augmentedArg.name in args) {
                        extra[augmentedArg.name] = argValue;
                    }
                    break;
                case "input.field":
                    if (augmentedArg.name in args && resolvers.input) {
                        ctx = await resolvers.input(ctx, augmentedArg._augmentedField, argValue) || ctx;
                        processed = true;
                    }
                    break;
                case "input.nested":
                    if (typeof argValue === 'object' && resolvers.nested) {
                        ctx = await resolvers.nested(ctx,
                            augmentedArg._augmentedField,
                            await this._resolve(argValue, augmentedArg.type.name, schema, ctx),
                            augmentedArg.type._augmentedTypeName || augmentedArg.type.name
                        ) || ctx;
                        processed = true;
                    }
                    break;
                case "input.nestedKey":
                    if (augmentedArg.name in args && resolvers.nested) {
                        ctx = await resolvers.nested(ctx,
                            augmentedArg._augmentedField,
                            await this._resolve({[augmentedArg._augmentedKey]: argValue}, augmentedArg._augmentedObjectTypeName, schema, ctx),
                            augmentedArg._augmentedTypeName
                        ) || ctx;
                        processed = true;
                    }
                    break;
                case "input.inputs":
                    if (Array.isArray(argValue)) {
                        const subTypeName = getNamedType(augmentedArg.type).name;
                        for (const arg of argValue) {
                            let ictx = await resolvers.init(parentContext);
                            ictx = await this._resolve(arg, subTypeName, schema, parentContext, ictx);
                            ctxs.push(ictx);
                        }
                    }
                    break;
                default:
                    if (augmentedArg.name in args && resolvers.others) {
                        ctx = await resolvers.others(ctx, augmentedArg.name, argValue) || ctx;
                        processed = true;
                    }
                    break;
            }
        }
        if (existingContext) {
            return ctx;
        }
        if (parentContext) {
            return await resolvers.resolve(ctx);
        } else {
            if (processed || ctxs.length <= 0) {
                ctxs.unshift(ctx);
            }
            if (extra[ARG_NAME_PAGESIZE] !== undefined) {
                extra[ARG_NAME_LIMIT] = extra[ARG_NAME_PAGESIZE];
                delete extra[ARG_NAME_PAGESIZE];
            }
            if (extra[ARG_NAME_PAGE] !== undefined) {
                if (extra[ARG_NAME_LIMIT] !== undefined) {
                    extra[ARG_NAME_OFFSET] = extra[ARG_NAME_LIMIT] * (extra[ARG_NAME_PAGE] - 1);
                }
                delete extra[ARG_NAME_PAGE];
            }
            if (augmentedResultType) {
                return new ResultsResolver(resolvers, ctxs, extra);
            } else {
                return await resolvers.return(ctxs, extra);
            }
        }
    }

}


class Sortable extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        if (details.objectType !== this.schema.getQueryType()) {
            throw new Error('directive "@sortable" should only be used on root query field definitions');
        }
        if (!this.schema.getType(field.name)) {
            throw new Error(`directive "@sortable" used on field "${field.name}" which does not match any of the existing types`);
        }
        const existingArgs = new Set(field.args.map(a => a.name));
        const sortInputTypeName = `${ARG_NAME_SORT}Input`;
        let sortInputType = this.schema.getType(sortInputTypeName);
        if (!sortInputType) {
            sortInputType = new GraphQLInputObjectType({
                name: sortInputTypeName,
                fields: {
                    by: {type: new GraphQLNonNull(GraphQLString), description: '需要排序的字段'},
                    desc: {type: GraphQLBoolean, defaultValue: false, description: '降序为true，默认为false'}
                }
            });
            sortInputType._augmentType = 'sort.inputType';
            this.schema.getTypeMap()[sortInputTypeName] = sortInputType;
        } else if (!sortInputType._augmentType) {
            return;
        }
        const arg = {
            name: ARG_NAME_SORT, type: new GraphQLList(new GraphQLNonNull(sortInputType)), _augmentType: 'sort.sort'
        };
        if (!existingArgs.has(ARG_NAME_SORT)) {
            field.args.push(arg);
        }
        // const filterInputType = ensureFilterInputType(this.schema, field.name);
        // const filterInputTypeFields = filterInputType.getFields();
        // if (!(sortArgName in filterInputTypeFields)) {
        //     filterInputTypeFields[sortArgName] = arg;
        // }
    }

}


class Pageable extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        if (details.objectType !== this.schema.getQueryType()) {
            throw new Error('directive "@pageable" should only be used on root query field definitions');
        }
        if (!this.schema.getType(field.name)) {
            throw new Error(`directive "@pageable" used on field "${field.name}" which does not match any of the existing types`);
        }
        // const filterInputType = ensureFilterInputType(this.schema, field.name);
        // const filterInputTypeFields = filterInputType.getFields();
        const existingArgs = new Set(field.args.map(a => a.name));
        if (!existingArgs.has(ARG_NAME_PAGE)) {
            field.args.push({
                name: ARG_NAME_PAGE, type: GraphQLInt, defaultValue: 1, _augmentType: 'filter.pagination'
            });
        }
        if (!existingArgs.has(ARG_NAME_PAGESIZE)) {
            field.args.push({
                name: ARG_NAME_PAGESIZE,
                type: GraphQLInt,
                defaultValue: this.args.default >= 0 ? this.args.default : 10,
                _augmentType: 'filter.pagination'
            });
        }
    }

}



class Filterable extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        if (details.objectType === this.schema.getQueryType()) {

            const queryField = this.schema.getQueryType().getFields()[field.name];
            if (queryField.args.every(a => a.name !== 'filters')) {
                const filterInputType = ensureFilterInputType(this.schema, field.name);
                queryField.args.push({name: 'filters', type: new GraphQLList(new GraphQLNonNull(filterInputType)), _augmentType: 'filter.filters'});
            }

        } else {

            const filterInputType = ensureFilterInputType(this.schema, details.objectType.name);
            const filterInputTypeFields = filterInputType.getFields();
            const fieldType = getNamedType(field.type);
            const augments = [];
            if (isInputType(fieldType)) {
                const operators = this.args.op || getEligibleOperators(fieldType);
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
                if (!(augment.name in filterInputTypeFields)) {
                    filterInputTypeFields[augment.name] = augment;
                }
            }
            const queryField = this.schema.getQueryType().getFields()[details.objectType.name];
            if (!queryField) {
                return;
            }
            for (const augment of augments) {
                queryField.args.push(augment);
            }

        }
    }

}

class Inputable extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        if (details.objectType === this.schema.getMutationType()) {

            if (!field.name.startsWith('Update')) {
                throw new Error('directive "@inputable" should be used on root query fields that only starts with "Update..."');
            }
            const typeName = field.name.slice(6);
            if (!this.schema.getType(typeName)) {
                throw new Error(`directive "@inputable" used on field "${field.name}" but "${typeName}" does not match any of the existing types`);
            }
            if (field.args.every(a => a.name !== 'inputs')) {
                field.args.push({
                    name: 'inputs',
                    type: new GraphQLList(new GraphQLNonNull(ensureInputType(this.schema, typeName))),
                    _augmentType: 'input.inputs'
                })
            }

        } else {

            const inputTypeFields = ensureInputType(this.schema, details.objectType.name).getFields();
            const fieldType = getNamedType(field.type);
            const augment = {
                name: field.name,
                description: field.description,
            };
            if (isInputType(fieldType)) {
                augment._augmentType = 'input.field';
                augment._augmentedField = field.name;
                augment.type = getNullableType(field.type);
            } else if ((fieldType instanceof GraphQLObjectType)) {
                let augType = ensureInputType(this.schema, fieldType.name);
                if (this.args.key) {
                    const subField = fieldType.getFields()[this.args.key];
                    if (!subField) {
                        throw new Error(`field "${this.args.key}" does not exist in type "${fieldType.name}"`);
                    }
                    augType = getNullableType(subField.type);
                    if (augType instanceof GraphQLList || !isInputType(augType)) {
                        throw new Error(`field "${this.args.key}" in type "${fieldType.name}" as an input key needs to be of a scalar type`);
                    }
                    augment._augmentType = 'input.nestedKey';
                    augment._augmentedObjectTypeName = augType.name;
                    augment._augmentedTypeName = augType._augmentedTypeName;
                    augment._augmentedKey = this.args.key;
                    augment._augmentedField = field.name;
                } else {
                    augment._augmentType = 'input.nested';
                    augment._augmentedField = field.name;
                }
                const nullableFieldType = getNullableType(field.type);
                if (nullableFieldType instanceof GraphQLList) {
                    if (nullableFieldType.ofType instanceof GraphQLNonNull) {
                        augType = new GraphQLNonNull(augType);
                    }
                    augType = new GraphQLList(augType);
                }
                augment.type = augType;
            } else {
                throw new Error(`field ${field.name} cannot be processed as inputable`);
            }
            if (this.args.required === undefined && field.type instanceof GraphQLNonNull || this.args.required) {
                augment.type = new GraphQLNonNull(augment.type);
            }
            inputTypeFields[augment.name] = augment;
            let mutationType = this.schema.getMutationType();
            if (!mutationType) {
                return;
            }
            const mutationName = `Update${details.objectType.name}`;
            let mutationField = mutationType.getFields()[mutationName];
            if (!mutationField) {
                return;
            }
            mutationField.args.push({...augment, type: getNullableType(augment.type)});

        }
    }

}


class Results extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        if (details.objectType !== this.schema.getQueryType()) {
            throw new Error('directive "@results" should only be used on root query field definitions');
        }
        if (field.type._augmentType !== 'result.type') {
            field.type = ensureResultType(this.schema, field.type);
        }
    }

}


class ResultsResolver {

    constructor(resolvers, ctxs, extra) {
        this.resolvers = resolvers;
        this.ctxs = ctxs;
        this.extra = extra;

        this._results = undefined;
        this._count = undefined;
    }

    async getResults() {
        if (this._results === undefined) {
            if (this.resolvers.return) {
                this._results = this.resolvers.return(this.ctxs, this.extra);
            }
        }
        return this._results;
    }

    async getCount() {
        // if (this._count === undefined) {
        //     if (this._results !== undefined) {
        //         const results = await this._results;
        //         if (Array.isArray(results)) {
        //             this._count = results.length;
        //         }
        //     }
        // }
        if (this._count === undefined) {
            if (this.resolvers.count) {
                this._count = this.resolvers.count(this.ctxs, this.extra);
            }
        }
        return this._count;
    }

}


module.exports = {
    AugmentedArgResolver,
    ResultsResolver,

    schemaDirectives: {
        sortable: Sortable,
        pageable: Pageable,
        filterable: Filterable,
        inputable: Inputable,
        results: Results,
    },

    UserInputError,

    isInputType, getNamedType, getNullableType,
    GraphQLBoolean, GraphQLInt, GraphQLFloat, GraphQLString, GraphQLID,
    GraphQLDateTime, GraphQLJSON, GraphQLJSONObject,
    GraphQLInputObjectType, GraphQLObjectType,
    GraphQLList, GraphQLNonNull,
};