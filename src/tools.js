const {UserInputError} = require('apollo-server-errors');
const {getNamedType} = require('graphql');

const config = require('./config');
const {ResultResolver} = require('./directives/result');
const {checkAuth, getJwtPayload} = require('./utils');


const ALL_MUTATION_MODES = {
    [config.FIELD_PREFIX_INSERT]: config.MODE_INSERT,
    [config.FIELD_PREFIX_UPDATE]: config.MODE_UPDATE,
    [config.FIELD_PREFIX_UPSERT]: config.MODE_UPSERT,
};

class AugmentedArgResolver {

    constructor(resolvers, options) {
        this.resolvers = resolvers;
        const {depthFirst} = options || {};
        this.depthFirst = depthFirst || false;
    }

    async resolve(args, ...resolveInfo) {
        let fieldName, schema, jwtPayload;
        if (resolveInfo[0].fieldName) {
            fieldName = resolveInfo[0].fieldName;
            schema = resolveInfo[0].schema;
            jwtPayload = resolveInfo[1];
        } else if (typeof resolveInfo[0] === 'string') {
            fieldName = resolveInfo[0];
            schema = resolveInfo[1];
            jwtPayload = resolveInfo[2];
        }
        jwtPayload = getJwtPayload(jwtPayload, schema);
        return await this._resolve(args, fieldName, schema, jwtPayload);
    }

    async _resolve(args, typeName, schema, jwtPayload, parentContext, existingContext) {
        let augmentedSchemaArgs;
        let augmentedResultType;
        let mode;
        if (parentContext) {
            const type = schema.getType(typeName);
            if (!type) {
                throw new UserInputError(`type "${typeName}" is not valid`);
            }
            if (type._augmentedTypeName) {
                typeName = type._augmentedTypeName;
            }
            mode = type._augmentedMode;
            augmentedSchemaArgs = Object.values(type.getFields());
        } else {
            const prefix = Object.keys(ALL_MUTATION_MODES).find(p => typeName.startsWith(p));
            if (prefix) {
                const mutationType = schema.getMutationType();
                let field;
                if (mutationType) {
                    field = mutationType.getFields()[typeName];
                }
                if (!field) {
                    throw new UserInputError(`mutation type "${typeName}" is not valid`);
                }
                augmentedSchemaArgs = field.args;
                typeName = typeName.slice(prefix.length);
                mode = ALL_MUTATION_MODES[prefix];
                await checkAuth(jwtPayload, field._auth && field._auth[mode], this.resolvers.auth, undefined, field.name, 'query', args)
            } else {
                const queryType = schema.getQueryType();
                let field;
                if (queryType) {
                    field = queryType.getFields()[typeName];
                }
                if (field) {
                    augmentedSchemaArgs = field.args;
                    typeName = typeName.slice(config.FIELD_PREFIX_QUERY.length);
                    mode = config.MODE_QUERY;
                    if (field.type._augmentType === 'result.type') {
                        augmentedResultType = field.type;
                    }
                    await checkAuth(jwtPayload, field._auth && field._auth[mode], this.resolvers.auth, undefined, field.name, 'query', args)
                } else {
                    const type = schema.getType(typeName);
                    if (!type) {
                        throw new UserInputError(`type "${typeName}" is not valid`);
                    }
                    if (type._augmentedTypeName) {
                        typeName = type._augmentedTypeName;
                    }
                    mode = type._augmentedMode;
                    augmentedSchemaArgs = Object.values(type.getFields());
                }
            }
        }
        const type = schema.getType(typeName);
        await checkAuth(jwtPayload, type._auth && type._auth[mode], this.resolvers.auth, type, undefined, 'query', args);
        let ctx = existingContext ? existingContext : await this.resolvers.init(parentContext, type);
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
                    if (augmentedArg.name in args && this.resolvers.filter) {
                        await checkAuth(
                            jwtPayload, (type.getFields()[augmentedArg._augmentedField]._auth || {})[mode],
                            this.resolvers.auth, type, augmentedArg._augmentedField, mode, args
                        );
                        ctx = await this.resolvers.filter(ctx,
                            augmentedArg._augmentedField, augmentedArg._augmentedOperator, argValue,
                            type
                        ) || ctx;
                        processed = true;
                    }
                    break;
                case "filter.nested":
                    if (typeof argValue === 'object' && this.resolvers.nested) {
                        await checkAuth(
                            jwtPayload, (type.getFields()[augmentedArg._augmentedField]._auth || {})[mode],
                            this.resolvers.auth, type, augmentedArg._augmentedField, mode, args
                        );
                        ctx = await this.resolvers.nested(ctx,
                            augmentedArg._augmentedField,
                            await this._resolve(argValue, augmentedArg.type.name, schema, jwtPayload, ctx),
                            type
                        ) || ctx;
                        processed = true;
                    }
                    break;
                case "filter.filters":
                    if (Array.isArray(argValue)) {
                        const subTypeName = getNamedType(augmentedArg.type).name;
                        for (const arg of argValue) {
                            let ictx = await this.resolvers.init(parentContext, type);
                            ictx = await this._resolve(arg, subTypeName, schema, jwtPayload, parentContext, ictx);
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
                    if (augmentedArg.name in args && this.resolvers.input) {
                        await checkAuth(
                            jwtPayload, (type.getFields()[augmentedArg._augmentedField]._auth || {})[mode],
                            this.resolvers.auth, type, augmentedArg._augmentedField, mode, args
                        );
                        ctx = await this.resolvers.input(ctx, augmentedArg._augmentedField, argValue, type) || ctx;
                        processed = true;
                    }
                    break;
                case "input.nested":
                    if (typeof argValue === 'object' && this.resolvers.nested) {
                        await checkAuth(
                            jwtPayload, (type.getFields()[augmentedArg._augmentedField]._auth || {})[mode],
                            this.resolvers.auth, type, augmentedArg._augmentedField, mode, args
                        );
                        ctx = await this.resolvers.nested(ctx,
                            augmentedArg._augmentedField,
                            await this._resolve(argValue, augmentedArg.type.name, schema, jwtPayload, ctx),
                            type
                        ) || ctx;
                        processed = true;
                    }
                    break;
                case "input.nestedKey":
                    if (augmentedArg.name in args && this.resolvers.nested) {
                        await checkAuth(
                            jwtPayload, (type.getFields()[augmentedArg._augmentedField]._auth || {})[mode],
                            this.resolvers.auth, type, augmentedArg._augmentedField, mode, args
                        );
                        ctx = await this.resolvers.nested(ctx,
                            augmentedArg._augmentedField,
                            await this._resolve({[augmentedArg._augmentedKey]: argValue}, augmentedArg._augmentedObjectTypeName, schema, jwtPayload, ctx),
                            type
                        ) || ctx;
                        processed = true;
                    }
                    break;
                case "input.inputs":
                    if (Array.isArray(argValue)) {
                        const subTypeName = getNamedType(augmentedArg.type).name;
                        for (const arg of argValue) {
                            let ictx = await this.resolvers.init(parentContext, type);
                            ictx = await this._resolve(arg, subTypeName, schema, jwtPayload, parentContext, ictx);
                            ctxs.push(ictx);
                        }
                    }
                    break;
                default:
                    if (augmentedArg.name in args && this.resolvers.others) {
                        ctx = await this.resolvers.others(ctx, augmentedArg.name, argValue, type) || ctx;
                        processed = true;
                    }
                    break;
            }
        }
        if (existingContext) {
            return ctx;
        }
        if (parentContext) {
            return await this.resolvers.resolve(ctx, type);
        } else {
            if (processed || ctxs.length <= 0) {
                ctxs.unshift(ctx);
            }
            if (extra[config.ARG_NAME_PAGESIZE] !== undefined) {
                const limit = extra[config.ARG_NAME_PAGESIZE];
                delete extra[config.ARG_NAME_PAGESIZE];
                extra[config.ARG_NAME_LIMIT] = limit;
            }
            if (extra[config.ARG_NAME_PAGE] !== undefined) {
                const page = extra[config.ARG_NAME_PAGE];
                delete extra[config.ARG_NAME_PAGE];
                if (extra[config.ARG_NAME_LIMIT] !== undefined) {
                    extra[config.ARG_NAME_OFFSET] = extra[config.ARG_NAME_LIMIT] * (page - 1);
                }
            }
            const result = new ResultResolver(this.resolvers, ctxs, extra, type, jwtPayload);
            if (augmentedResultType) {
                return result;
            } else {
                return await result.getResults();
            }
        }
    }

}


module.exports = {
    AugmentedArgResolver,
};