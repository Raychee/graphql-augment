const {UserInputError} = require('apollo-server-errors');
const {getNamedType} = require('graphql');

const config = require('./config');
const {checkAuth, getJwtPayload, parseReturnFields, SimpleResponse} = require('./utils');


class AugmentedArgResolver {

    constructor(resolvers, {depthFirst = false} = {}) {
        if (!resolvers.init) {
            resolvers = {
                init() {
                    return {};
                },
                filter(ctx, field, op, value) {
                    ctx[field] = {op, value};
                },
                input(ctx, field, value) {
                    ctx[field] = value;
                },
                others(ctx, arg, value) {
                    ctx[arg] = value;
                },
                paginate(ctx, pagination) {
                    Object.assign(ctx, pagination);
                },
                sort(ctx, sort) {
                    ctx.sort = sort;
                },
                nested(ctx, field, nested) {
                    ctx[field] = nested;
                },
                resolve(ctx) {
                    return ctx;
                },
                ...resolvers
            };
        }
        this.resolvers = resolvers;
        this.depthFirst = depthFirst;
    }
    
    async resolve(parent, args, context, info) {
        const env = {parent, args, context, info};
        const {fieldName, schema, parentType} = info;
        const jwtPayload = getJwtPayload(context, schema);
        let field, typeName, mode, rootMode, useResponseType = false;
        if (parent) {
            field = parentType.getFields()[fieldName];
            if (!field) {
                throw new UserInputError(`field "${fieldName}" from type "${parentType.name}" is not valid`);
            }
            mode = config.MODE_QUERY;
            typeName = getNamedType(field.type).name;
        } else {
            const mutationType = schema.getMutationType();
            if (mutationType) {
                field = mutationType.getFields()[fieldName];
                if (field) {
                    const {type, mode: mode_} = field._augmentedTarget || {};
                    mode = mode_ || config.MODE_MUTATE;
                    typeName = type;
                    rootMode = config.MODE_MUTATE;
                }
            }
            if (!field) {
                field = schema.getQueryType().getFields()[fieldName];
                if (field) {
                    const {type, mode: mode_} = field._augmentedTarget || {};
                    mode = mode_ || config.MODE_QUERY;
                    typeName = type;
                    rootMode = config.MODE_QUERY;
                }
            }
            if (!field) {
                throw new UserInputError(`unknown field name "${fieldName}"`);
            }
            if (getNamedType(field.type)._augmentType === 'result.response') {
                useResponseType = true;
            }
        }
        return await this._resolve(
            args, schema, env, {
                field, typeName, useResponseType, mode, rootMode, jwtPayload, isFirst: true,
                returnFields: parseReturnFields(info), 
            }
        );
    }

    async _resolve(
        args, schema, env, {
            field, typeName, mode, rootMode, jwtPayload, parent, parentType, parentField, parentArgs, returnFields,
            returnCtx, useResponseType, isInBatch, isFirst, 
        }
    ) {
        let augmentedSchemaArgs, augmentedTypeName = undefined;
        if (field) {
            augmentedSchemaArgs = field.args;
            augmentedTypeName = typeName;
        } else {
            const type = schema.getType(typeName);
            if (!type) {
                throw new UserInputError(`type "${typeName}" is not valid`);
            }
            augmentedTypeName = type._augmentedTypeName;
            mode = type._augmentedMode;
            augmentedSchemaArgs = Object.values(type.getFields());
        }

        const type = augmentedTypeName && schema.getType(augmentedTypeName);
        const commonResolverOptions = {
            type, mode, rootMode, args, env, parent, parentType, parentField, parentArgs, 
            returnFields, isInBatch, auth: jwtPayload,
        };
        let ctx = await this.resolvers.init(commonResolverOptions);
        await checkAuth(
            ctx, jwtPayload, this.resolvers.auth,
            {...commonResolverOptions, isFirst}
        );
        let pagination = {}, ctxs = [];
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
            const arg = augmentedArg.name;
            const field = augmentedArg._augmentedField && type && type.getFields()[augmentedArg._augmentedField];
            const fieldMode = augmentedArg._augmentType;
            const resolverOptions = {...commonResolverOptions, arg, field, fieldMode};
            switch (fieldMode) {
                case "filter.operator":
                    if (augmentedArg.name in args && this.resolvers.filter) {
                        const operator = augmentedArg._augmentedOperator;
                        await checkAuth(
                            ctx, jwtPayload, this.resolvers.auth,
                            {...resolverOptions, operator, value: argValue}
                        );
                        ctx = await this.resolvers.filter(ctx,
                            augmentedArg._augmentedField, augmentedArg._augmentedOperator, argValue,
                            resolverOptions,
                        ) || ctx;
                    }
                    break;
                case "filter.nested":
                    if (typeof argValue === 'object' && this.resolvers.nested) {
                        await checkAuth(
                            ctx, jwtPayload, this.resolvers.auth,
                            {...resolverOptions, value: argValue}
                        );
                        const resolved = argValue == null ? argValue : await this._resolve(
                            argValue, schema, env,
                            {
                                typeName: getNamedType(augmentedArg.type).name, mode, jwtPayload,
                                parent: ctx, parentType: type, parentField: field, parentArgs: args,
                                returnFields,
                            }
                        );
                        ctx = await this.resolvers.nested(
                            ctx, augmentedArg._augmentedField, resolved, resolverOptions,
                        ) || ctx;
                    }
                    break;
                case "filter.filters":
                    if (Array.isArray(argValue)) {
                        const subTypeName = getNamedType(augmentedArg.type).name;
                        for (const arg of argValue) {
                            const ictx = await this._resolve(arg, schema, env, {
                                typeName: subTypeName, mode, jwtPayload,
                                parent, parentType, parentField, parentArgs: args, returnFields,
                                returnCtx: true, isInBatch: true,
                            });
                            ctxs.push(ictx);
                        }
                    }
                    break;
                case "filter.pagination":
                    if (augmentedArg.name in args) {
                        pagination[augmentedArg.name] = argValue;
                    }
                    break;
                case "sort.sort":
                    if (augmentedArg.name in args && this.resolvers.sort) {
                        await checkAuth(
                            ctx, jwtPayload, this.resolvers.auth,
                            {...resolverOptions, sort: argValue}
                        );
                        ctx = await this.resolvers.sort(ctx, argValue, resolverOptions) || ctx;
                    }
                    break;
                case "cursor.cursor":
                    if (augmentedArg.name in args && this.resolvers.cursor) {
                        await checkAuth(
                            ctx, jwtPayload, this.resolvers.auth,
                            {...resolverOptions, cursor: argValue}
                        );
                        ctx = await this.resolvers.cursor(ctx, argValue, resolverOptions) || ctx;
                    }
                    break;
                case "input.field":
                    if (augmentedArg.name in args && this.resolvers.input) {
                        await checkAuth(
                            ctx, jwtPayload, this.resolvers.auth,
                            {...resolverOptions, value: argValue},
                        );
                        ctx = await this.resolvers.input(
                            ctx, augmentedArg._augmentedField, argValue, resolverOptions,
                        ) || ctx;
                    }
                    break;
                case "input.nested":
                    if (typeof argValue === 'object' && this.resolvers.nested) {
                        await checkAuth(
                            ctx, jwtPayload, this.resolvers.auth,
                            {...resolverOptions, value: argValue}
                        );
                        if (Array.isArray(argValue)) {
                            const tctxs = [];
                            for (const argV of argValue) {
                                const resolved = argV == null ? argV : await this._resolve(
                                    argV, schema, env,
                                    {
                                        typeName: getNamedType(augmentedArg.type).name,
                                        mode, jwtPayload, parent: ctx, parentType: type,
                                        parentArgs: args, parentField: field, returnFields,
                                    }
                                );
                                tctxs.push(resolved);
                            }
                            ctx = await this.resolvers.nested(
                                ctx, augmentedArg._augmentedField, tctxs, resolverOptions,
                            ) || ctx;
                        } else {
                            const resolved = argValue == null ? argValue : await this._resolve(
                                argValue, schema, env, {
                                    typeName: getNamedType(augmentedArg.type).name,
                                    mode, jwtPayload, parent: ctx,
                                    parentType: type, parentField: field, parentArgs: args, returnFields,
                                }
                            );
                            ctx = await this.resolvers.nested(ctx,
                                augmentedArg._augmentedField, resolved, resolverOptions,
                            ) || ctx;
                        }
                    }
                    break;
                case "input.nestedKey":
                    if (augmentedArg.name in args && this.resolvers.nested) {
                        await checkAuth(
                            ctx, jwtPayload, this.resolvers.auth,
                            {...resolverOptions, value: argValue},
                        );
                        if (Array.isArray(argValue)) {
                            const tctxs = [];
                            for (const argV of argValue) {
                                const ictx = await this._resolve({[augmentedArg._augmentedKey]: argV}, schema, env, {
                                    typeName: augmentedArg._augmentedObjectTypeName,
                                    mode, jwtPayload, parent: ctx, parentType: type,
                                    parentArgs: args, parentField: field, returnFields,
                                    returnCtx: true,
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
                                    mode, jwtPayload, parent: ctx, parentType: type,
                                    parentField: field, parentArgs: args, returnFields,
                                }),
                                resolverOptions,
                            ) || ctx;
                        }
                    }
                    break;
                case "input.inputs":
                    if (Array.isArray(argValue)) {
                        const subTypeName = getNamedType(augmentedArg.type).name;
                        for (const argV of argValue) {
                            const ictx = await this._resolve(argV, schema, env, {
                                typeName: subTypeName, mode, jwtPayload,
                                parent, parentType, parentField, parentArgs: args, returnFields,
                                isInBatch: true, returnCtx: true,
                            });
                            ctxs.push(ictx);
                        }
                    }
                    break;
                default:
                    if (augmentedArg.name in args && this.resolvers.others) {
                        await checkAuth(
                            ctx, jwtPayload, this.resolvers.auth,
                            {...resolverOptions, value: argValue},
                        );
                        ctx = await this.resolvers.others(ctx, augmentedArg.name, argValue, resolverOptions) || ctx;
                    }
                    break;
            }
        }
        if ((config.ARG_NAME_PAGESIZE in pagination || config.ARG_NAME_PAGE in pagination) && this.resolvers.paginate) {
            const resolverOptions = {...commonResolverOptions, fieldMode: 'filter.pagination'};
            await checkAuth(
                ctx, jwtPayload, this.resolvers.auth,
                {...resolverOptions, ...pagination}
            );
            ctx = await this.resolvers.paginate(ctx, pagination, resolverOptions) || ctx;
        }

        if (returnCtx) {
            return ctx;
        }
        if (parent) {
            await checkAuth(
                ctx, jwtPayload, this.resolvers.auth,
                {...commonResolverOptions, isBeforeResolve: true}
            );
            return await this.resolvers.resolve(ctx, commonResolverOptions);
        }
        ctxs.unshift(ctx);

        await checkAuth(
            ctx, jwtPayload, this.resolvers.auth,
            {...commonResolverOptions, isBeforeReturn: true},
        );
        
        const response = new SimpleResponse(
            this.resolvers, ctxs, jwtPayload, {
                ...commonResolverOptions,
                results: useResponseType ? returnFields[config.FIELD_NAME_RESULTS] : returnFields,
                cursor: useResponseType && returnFields[config.FIELD_NAME_CURSOR],
                count: useResponseType && returnFields[config.FIELD_NAME_COUNT],
                debug: useResponseType && returnFields[config.FIELD_NAME_DEBUG],
            },
        );
        if (useResponseType) {
            return response;
        } else {
            return await response.results();
        }
    }

}


module.exports = {
    AugmentedArgResolver,
};
