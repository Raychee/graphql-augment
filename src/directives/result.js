const {SchemaDirectiveVisitor} = require('graphql-tools');
const {getNamedType, defaultFieldResolver, GraphQLInt, GraphQLObjectType} = require('graphql');
const {GraphQLJSONObject} = require('graphql-type-json');

const config = require('../config');
const {sidecar, capitalize} = require('../utils');
const {getFieldAugments: getFieldAugmentsForQuery} = require('./query');
const {augmentField: augmentFieldForBatch} = require('./batch');
const {augmentField: augmentFieldForPage} = require('./page');
const {augmentField: augmentFieldForSort} = require('./sort');


class ResultResolver {

    constructor(resolvers, ctxs, jwt, options) {
        this.resolvers = resolvers;
        this.ctxs = ctxs;
        this.jwt = jwt;
        this.options = options;

        this._results = undefined;
        this._count = undefined;
    }

    async getResults() {
        if (this._results === undefined) {
            if (this.resolvers.return) {
                this._results = sidecar(
                    await this.resolvers.return(this.ctxs, this.options),
                    {auth: this.resolvers.auth, jwt: this.jwt},
                    '_augmentedSidecar'
                );
            }
        }
        return this._results;
    }

    async getCount() {
        if (this._count === undefined) {
            if (this.resolvers.count) {
                this._count = this.resolvers.count(this.ctxs, this.options);
            }
        }
        return this._count;
    }

    async getDebugInfo() {
        if (this._debug === undefined) {
            if (this.resolvers.debug) {
                this._debug = await this.resolvers.debug(this.ctxs, this.options);
            }
        }
        return this._debug;
    }

}


function ensureResultType(schema, fieldType) {
    const typeName = getNamedType(fieldType).name;
    const resultTypeName = `${typeName}${capitalize(config.MODE_RESULT)}`;
    let resultType = schema.getType(resultTypeName);
    if (!resultType) {
        resultType = new GraphQLObjectType({
            name: resultTypeName,
            fields: {
                results: {
                    type: fieldType,
                    async resolve(arg, ...args) {
                        if (arg instanceof ResultResolver) {
                            return await arg.getResults();
                        } else {
                            return defaultFieldResolver.call(this, arg, ...args);
                        }
                    }
                },
                count: {
                    type: GraphQLInt,
                    async resolve(arg, ...args) {
                        if (arg instanceof ResultResolver) {
                            return await arg.getCount();
                        } else {
                            return defaultFieldResolver.call(this, arg, ...args);
                        }
                    }
                },
                debug: {
                    type: GraphQLJSONObject,
                    async resolve(arg, ...args) {
                        if (arg instanceof ResultResolver) {
                            return await arg.getDebugInfo();
                        } else {
                            return defaultFieldResolver.call(this, arg, ...args);
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
        if (details.objectType === this.schema.getQueryType() || details.objectType === this.schema.getMutationType()) {
            if (field.type._augmentType !== 'result.type') {
                field.type = ensureResultType(this.schema, field.type);
            }
            return;
        }
        if (details.objectType === this.schema.getMutationType()) {
            throw new Error(`directive "@${config.MODE_RESULT}" should not be used on root mutation fields`);
        }
        field._augmentResult = true;
        const fieldType = getNamedType(field.type);
        if (!(fieldType instanceof GraphQLObjectType)) {
            return;
        }
        for (const typeField of Object.values(fieldType.getFields())) {
            if (typeField._augmentQuery) {
                const augments = getFieldAugmentsForQuery(this.schema, typeField);
                for (const augment of augments) {
                    if (field.args.every(a => a.name !== augment.name)) {
                        field.args.push(augment);
                    }
                }
            }
        }
        if (field._augmentBatch) {
            augmentFieldForBatch(this.schema, field, fieldType.name);
        }
        if (field._augmentPage) {
            augmentFieldForPage(field);
        }
        if (field._augmentSort) {
            augmentFieldForSort(this.schema, field);
        }
    }

}

module.exports = {
    Result,
    ResultResolver,
};
