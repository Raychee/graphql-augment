const {SchemaDirectiveVisitor} = require('graphql-tools');
const {getNamedType, defaultFieldResolver, GraphQLInt, GraphQLString, GraphQLObjectType} = require('graphql');
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

        this._returning = undefined;
        this._results = undefined;
        this._cursor = undefined;
        this._count = undefined;
        this._debug = undefined;
    }

    async getReturn() {
        if (this.resolvers.return && this._returning === undefined) {
            this._returning = this.resolvers.return(this.ctxs, this.options).then(returned => {
                this._results = returned.results;
                this._count = returned.count;
                this._cursor = returned.cursor;
                this._debug = returned.debug;
            });
        }
        if (this._returning) {
            await this._returning;
        }
    }

    async getResults() {
        if (this._results === undefined) {
            await this.getReturn();
        }
        if (this._results === undefined && this.resolvers.results) {
            this._results = await this.resolvers.results(this.ctxs, this.options);
        }
        return sidecar(
            this._results, {auth: this.resolvers.auth, jwt: this.jwt},
            '_augmentedSidecar'
        );
    }

    async getCursor() {
        if (this._cursor === undefined) {
            await this.getReturn();
        }
        return this._cursor;
    }

    async getCount() {
        if (this._count === undefined) {
            await this.getReturn();
        }
        if (this._count === undefined && this.resolvers.count) {
            this._count = this.resolvers.count(this.ctxs, this.options);
        }
        return this._count;
    }

    async getDebugInfo() {
        if (this._debug === undefined) {
            await this.getReturn();
        }
        if (this._debug === undefined && this.resolvers.debug) {
            this._debug = await this.resolvers.debug(this.ctxs, this.options);
        }
        return this._debug;
    }
}


function ensureResultType(schema, fieldType, args) {
    const typeName = getNamedType(fieldType).name;
    const resultTypeName = `${typeName}${args.cursor ? 'Tailable' : ''}${capitalize(config.MODE_RESULT)}`;
    let resultType = schema.getType(resultTypeName);
    if (!resultType) {
        resultType = new GraphQLObjectType({
            name: resultTypeName,
            fields: {
                [config.FIELD_NAME_RESULTS]: {
                    type: fieldType,
                    async resolve(arg, ...args) {
                        if (arg instanceof ResultResolver) {
                            return await arg.getResults();
                        } else {
                            return defaultFieldResolver.call(this, arg, ...args);
                        }
                    }
                },
                ...(args.cursor ? {
                    [config.FIELD_NAME_CURSOR]: {
                        type: GraphQLString,
                        async resolve(arg, ...args) {
                            if (arg instanceof ResultResolver) {
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
                        if (arg instanceof ResultResolver) {
                            return await arg.getCount();
                        } else {
                            return defaultFieldResolver.call(this, arg, ...args);
                        }
                    }
                },
                [config.FIELD_NAME_DEBUG]: {
                    type: GraphQLJSONObject,
                    async resolve(arg, ...args) {
                        if (arg instanceof ResultResolver) {
                            return await arg.getDebugInfo();
                        } else {
                            return defaultFieldResolver.call(this, arg, ...args);
                        }
                    }
                },
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
                field.type = ensureResultType(this.schema, field.type, this.args);
            }
            if (this.args.cursor) {
                if (field.args.every(a => a.name !== config.ARG_NAME_CURSOR)) {
                    field.args.push({
                        name: config.ARG_NAME_CURSOR,
                        type: GraphQLString,
                        _augmentType: 'cursor.cursor',
                    });
                }
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
