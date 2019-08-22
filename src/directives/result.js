const {SchemaDirectiveVisitor} = require('graphql-tools');
const {getNamedType, defaultFieldResolver, GraphQLInt, GraphQLObjectType} = require('graphql');
const {GraphQLJSONObject} = require('graphql-type-json');

const config = require('../config');
const {sideCar} = require('../utils');


class ResultResolver {

    constructor(resolvers, ctxs, extra, type, jwt) {
        this.resolvers = resolvers;
        this.ctxs = ctxs;
        this.extra = extra;
        this.type = type;
        this.jwt = jwt;

        this._results = undefined;
        this._count = undefined;
    }

    async getResults() {
        if (this._results === undefined) {
            if (this.resolvers.return) {
                this._results = sideCar(
                    await this.resolvers.return(this.ctxs, this.extra, this.type),
                    {auth: this.resolvers.auth, jwt: this.jwt}
                );
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
                this._count = this.resolvers.count(this.ctxs, this.extra, this.type);
            }
        }
        return this._count;
    }

    async getDebugInfo() {
        if (this._debug === undefined) {
            if (this.resolvers.debug) {
                this._debug = await this.resolvers.debug(this.ctxs, this.extra, this.type);
            }
        }
        return this._debug;
    }

}


function ensureResultType(schema, fieldType) {
    const typeName = getNamedType(fieldType).name;
    const resultTypeName = `${typeName}${config.FIELD_PREFIX_RESULT}`;
    let resultType = schema.getType(resultTypeName);
    if (!resultType) {
        resultType = new GraphQLObjectType({
            name: resultTypeName,
            fields: {
                results: {
                    type: fieldType,
                    async resolve(...args) {
                        if (args[0] instanceof ResultResolver) {
                            return await args[0].getResults();
                        } else {
                            return defaultFieldResolver.apply(this, args);
                        }
                    }
                },
                count: {
                    type: GraphQLInt,
                    async resolve(...args) {
                        if (args[0] instanceof ResultResolver) {
                            return await args[0].getCount();
                        } else {
                            return defaultFieldResolver.apply(this, args);
                        }
                    }
                },
                debug: {
                    type: GraphQLJSONObject,
                    async resolve(...args) {
                        if (args[0] instanceof ResultResolver) {
                            return await args[0].getDebugInfo();
                        } else {
                            return defaultFieldResolver.apply(this, args);
                        }
                    }
                }
            }
        });
        resultType._augmentType = 'result.type';
        resultType._augmentedTypeName = typeName;
        resultType._augmentedMode = config.MODE_RESULT;
        schema.getTypeMap()[resultTypeName] = resultType;
    }
    return resultType;
}


class Result extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        if (details.objectType !== this.schema.getQueryType() && details.objectType !== this.schema.getMutationType()) {
            throw new Error(`directive "@${config.MODE_RESULT}" should be only used on root query/mutation fields`);
        }
        if (field.type._augmentType !== 'result.type') {
            field.type = ensureResultType(this.schema, field.type);
        }
    }

}

module.exports = {
    Result,
    ResultResolver,
};