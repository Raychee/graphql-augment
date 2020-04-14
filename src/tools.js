const {UserInputError} = require('apollo-server-errors');
const {getNamedType} = require('graphql');

const config = require('./config');
const {ResultResolver} = require('./directives/result');
const {checkAuth, getJwtPayload} = require('./utils');


class AugmentedArgResolver {

    constructor(resolvers, {depthFirst = false} = {}) {
        this.resolvers = resolvers;
        this.depthFirst = depthFirst;
    }

    async resolve(parent, args, context, info) {
        const env = {parent, args, context, info};
        const {fieldName, schema, parentType} = info;
        const jwtPayload = getJwtPayload(context, schema);
        let field, typeName, mode, useResultType = false;
        if (parent) {
            field = parentType.getFields()[fieldName];
            if (!field) {
                throw new UserInputError(`field "${fieldName}" from type "${parentType.name}" is not valid`);
            }
            mode = config.MODE_QUERY;
        } else {
            const allMutationModes =  {
                [config.FIELD_PREFIX_INSERT]: config.MODE_INSERT,
                [config.FIELD_PREFIX_UPDATE]: config.MODE_UPDATE,
                [config.FIELD_PREFIX_UPSERT]: config.MODE_UPSERT,
            };
            const prefixMutation = Object.keys(allMutationModes).find(p => fieldName.startsWith(p));
            const prefixQuery = fieldName.startsWith(config.FIELD_PREFIX_QUERY) ? config.FIELD_PREFIX_QUERY : undefined;
            if (prefixMutation) {
                const mutationType = schema.getMutationType();
                if (mutationType) {
                    field = mutationType.getFields()[fieldName];
                }
                if (!field) {
                    throw new UserInputError(`mutation type "${fieldName}" is not valid`);
                }
                mode = allMutationModes[prefixMutation];
                typeName = fieldName.slice(prefixMutation.length);
            } else if (prefixQuery !== undefined) {
                const queryType = schema.getQueryType();
                if (queryType) {
                    field = queryType.getFields()[fieldName];
                }
                if (!field) {
                    throw new UserInputError(`query type "${fieldName}" is not valid`);
                }
                mode = config.MODE_QUERY;
                typeName = fieldName.slice(prefixQuery.length);
            } else {
                throw new UserInputError(`unknown field name "${fieldName}"`);
            }
            if (field.type._augmentType === 'result.type') {
                useResultType = true;
            }
        }
        return await this._resolve(
            args, schema, env, {field, typeName, useResultType, mode, jwtPayload}
        );
    }

    async _resolve(
        args, schema, env, {
            field, typeName, mode, jwtPayload, parent, parentType, existingCtx, useResultType,
        }
    ) {
        let augmentedSchemaArgs;
        if (field) {
            augmentedSchemaArgs = field.args;
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
        if (!typeName) {
            typeName = getNamedType(field.type).name;
        }

        const type = schema.getType(typeName);
        const commonResolverOptions = {type, mode, args, env, parent, parentType};
        let ctx = existingCtx || await this.resolvers.init(parent, commonResolverOptions);
        await checkAuth(
            ctx, jwtPayload, (type._auth || {})[mode], this.resolvers.auth,
            commonResolverOptions
        );
        let extra = {}, ctxs = [], processed = false;
        const plain = [], nested = [];
        for (const augmentedArg of augmentedSchemaArgs) {
            if (['filter.nested', 'input.nested'].includes(augmentedArg._augmentType)) {
                nested.push({augmentedArg, argValue: args[augmentedArg.name]});
            } else {
                plain.push({augmentedArg, argValue: args[augmentedArg.name]});
            }
        }
        const process = this.depthFirst ? [...nested, ...plain] : [...plain, ...nested];
        for (const {augmentedArg, argValue} of process) {
            const targetField = augmentedArg._augmentedField && type.getFields()[augmentedArg._augmentedField];
            const resolverOptions = {...commonResolverOptions, field: targetField};
            switch (augmentedArg._augmentType) {
                case "filter.operator":
                    if (augmentedArg.name in args && this.resolvers.filter) {
                        await checkAuth(
                            ctx, jwtPayload, (targetField._auth || {})[mode], this.resolvers.auth,
                            resolverOptions,
                        );
                        ctx = await this.resolvers.filter(ctx,
                            augmentedArg._augmentedField, augmentedArg._augmentedOperator, argValue,
                            resolverOptions,
                        ) || ctx;
                        processed = true;
                    }
                    break;
                case "filter.nested":
                    if (typeof argValue === 'object' && this.resolvers.nested) {
                        await checkAuth(
                            ctx, jwtPayload, (targetField._auth || {})[mode], this.resolvers.auth,
                            resolverOptions,
                        );
                        ctx = await this.resolvers.nested(ctx,
                            augmentedArg._augmentedField,
                            await this._resolve(
                                argValue, schema, env,
                                {typeName: augmentedArg.type.name, mode, jwtPayload, parent: ctx, parentType: type}
                            ),
                            resolverOptions,
                        ) || ctx;
                        processed = true;
                    }
                    break;
                case "filter.filters":
                    if (Array.isArray(argValue)) {
                        const subTypeName = getNamedType(augmentedArg.type).name;
                        for (const arg of argValue) {
                            let ictx = await this.resolvers.init(parent, commonResolverOptions);
                            ictx = await this._resolve(arg, schema, env, {
                                typeName: subTypeName, mode, jwtPayload, parent, parentType, existingCtx: ictx,
                            });
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
                            ctx, jwtPayload, (targetField._auth || {})[mode], this.resolvers.auth,
                            resolverOptions
                        );
                        ctx = await this.resolvers.input(
                            ctx, augmentedArg._augmentedField, argValue, resolverOptions,
                        ) || ctx;
                        processed = true;
                    }
                    break;
                case "input.nested":
                    if (typeof argValue === 'object' && this.resolvers.nested) {
                        await checkAuth(
                            ctx, jwtPayload, (targetField._auth || {})[mode], this.resolvers.auth,
                            resolverOptions,
                        );
                        if (Array.isArray(argValue)) {
                            const tctxs = [];
                            for (const argV of argValue) {
                                let ictx = await this.resolvers.init(parent, commonResolverOptions);
                                ictx = await this._resolve(argV, schema, env, {
                                    typeName: getNamedType(augmentedArg.type).name,
                                    mode, jwtPayload, parent: ctx, parentType: type, existingCtx: ictx,
                                });
                                tctxs.push(ictx);
                            }
                            ctx = await this.resolvers.nested(
                                ctx, augmentedArg._augmentedField, tctxs, resolverOptions,
                            ) || ctx;
                        } else {
                            ctx = await this.resolvers.nested(ctx,
                                augmentedArg._augmentedField,
                                await this._resolve(
                                    argValue, schema, env, {
                                        typeName: augmentedArg.type.name,
                                        mode, jwtPayload, parent: ctx, parentType: type
                                    }
                                ),
                                resolverOptions,
                            ) || ctx;
                        }
                        processed = true;
                    }
                    break;
                case "input.nestedKey":
                    if (augmentedArg.name in args && this.resolvers.nested) {
                        await checkAuth(
                            ctx, jwtPayload, (targetField._auth || {})[mode], this.resolvers.auth,
                            resolverOptions,
                        );
                        if (Array.isArray(argValue)) {
                            const tctxs = [];
                            for (const argV of argValue) {
                                let ictx = await this.resolvers.init(parent, commonResolverOptions);
                                ictx = await this._resolve({[augmentedArg._augmentedKey]: argV}, schema, env, {
                                    typeName: augmentedArg._augmentedObjectTypeName,
                                    mode, jwtPayload, parent: ctx, parentType: type, existingCtx: ictx,
                                });
                                tctxs.push(ictx);
                            }
                            ctx = await this.resolvers.nested(
                                ctx, augmentedArg._augmentedField, tctxs, resolverOptions,
                            ) || ctx;
                        } else {
                            ctx = await this.resolvers.nested(
                                ctx,
                                augmentedArg._augmentedField,
                                await this._resolve({[augmentedArg._augmentedKey]: argValue}, schema, env, {
                                    typeName: augmentedArg._augmentedObjectTypeName,
                                    mode, jwtPayload, parent: ctx, parentType: type
                                }),
                                resolverOptions,
                            ) || ctx;
                        }
                        processed = true;
                    }
                    break;
                case "input.inputs":
                    if (Array.isArray(argValue)) {
                        const subTypeName = getNamedType(augmentedArg.type).name;
                        for (const argV of argValue) {
                            let ictx = await this.resolvers.init(parent, commonResolverOptions);
                            ictx = await this._resolve(argV, schema, env, {
                                typeName: subTypeName, mode, jwtPayload, parent, parentType, existingCtx: ictx,
                            });
                            ctxs.push(ictx);
                        }
                    }
                    break;
                default:
                    if (augmentedArg.name in args && this.resolvers.others) {
                        ctx = await this.resolvers.others(ctx, augmentedArg.name, argValue, resolverOptions) || ctx;
                        processed = true;
                    }
                    break;
            }
        }
        if (existingCtx) {
            return ctx;
        }
        if (parent) {
            return await this.resolvers.resolve(ctx, commonResolverOptions);
        }
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
        const result = new ResultResolver(
            this.resolvers, ctxs, extra, jwtPayload, commonResolverOptions
        );
        if (useResultType) {
            return result;
        } else {
            return await result.getResults();
        }
    }

}


module.exports = {
    AugmentedArgResolver,
};