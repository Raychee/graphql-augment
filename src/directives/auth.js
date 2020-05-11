const {SchemaDirectiveVisitor} = require('graphql-tools');
const {
    getNullableType, defaultFieldResolver,
    GraphQLInt, GraphQLString, GraphQLFloat, GraphQLBoolean, GraphQLID,
    GraphQLEnumType, GraphQLObjectType, GraphQLNonNull, GraphQLList,
} = require('graphql');
const {GraphQLDate, GraphQLTime, GraphQLDateTime} = require('graphql-iso-date');
const {GraphQLJSON, GraphQLJSONObject} = require('graphql-type-json');

const config = require('../config');
const {checkAuth} = require('../utils');


const ALL_AUTH_PREFIXES = [
    config.MODE_QUERY,
    config.MODE_INSERT,
    config.MODE_UPDATE,
    config.MODE_UPSERT,
    config.MODE_RESULT,
];


function getDefaultValue(type) {
    if (!(type instanceof GraphQLNonNull)) {
        return undefined;
    }
    type = getNullableType(type);
    if (type instanceof GraphQLList) {
        return [];
    }
    if (type instanceof GraphQLObjectType || type.name === GraphQLJSONObject.name) {
        const ret = {};
        if (type instanceof GraphQLObjectType) {
            for (const field of Object.values(type.getFields())) {
                const v = getDefaultValue(field.type);
                if (v !== undefined) {
                    ret[field.name] = v;
                }
            }
        }
        return ret;
    }
    if ([GraphQLString, GraphQLID, GraphQLJSON].map(t => t.name).indexOf(type.name) >= 0 || type instanceof GraphQLEnumType) {
        return "";
    }
    if ([GraphQLInt, GraphQLFloat].map(t => t.name).indexOf(type.name) >= 0) {
        return 0;
    }
    if ([GraphQLDateTime, GraphQLDate, GraphQLTime].map(t => t.name).indexOf(type.name) >= 0) {
        return new Date(0);
    }
    if (type.name === GraphQLBoolean.name) {
        return false;
    }
    return undefined;
}


function ensureAuthFieldResolvers(type) {
    if (type._hasAuthResolvers) return;
    for (const field of Object.values(type.getFields())) {
        const {resolve = defaultFieldResolver} = field;
        field.resolve = async function (parent, args, context, info) {
            const extra = parent && parent._extra;
            const env = {parent, args, context, info};
            const options = {
                type, mode: config.MODE_RESULT, args, env,
                auth: type._auth && type._auth[config.MODE_RESULT]
            };
            if (extra) {
                const {jwt: jwtPayload, auth: checkAuthFn} = extra;
                await checkAuth({}, jwtPayload, checkAuthFn, options);
                const message = await checkAuth(
                    {}, jwtPayload, checkAuthFn,
                    {
                        ...options,
                        field, silent: (field._auth || {}).silent,
                        auth: (field._auth || {})[config.MODE_RESULT]
                    },
                );
                if (message) {
                    return getDefaultValue(field.type);
                }
            }
            return resolve.call(this, parent, args, context, info);
        }
    }
    type._hasAuthResolvers = true;
}


class Auth extends SchemaDirectiveVisitor {

    visitObject(type) {
        if (type === this.schema.getQueryType()) {
            throw new Error(`directive "@auth" should not be used on root query type`);
        }
        if (type === this.schema.getMutationType()) {
            throw new Error(`directive "@auth" should not be used on root mutation type`);
        }
        if (this.args.all || this.args.result) {
            ensureAuthFieldResolvers(type);
        }
        this._addAuth(type);
    }

    visitFieldDefinition(field, details) {
        if (this.args.all || this.args.result) {
            ensureAuthFieldResolvers(details.objectType);
        }
        this._addAuth(field);
    }

    _addAuth(typeOrField) {
        if (this.args.all) {
            for (const p of ALL_AUTH_PREFIXES) {
                this.args[p] = this.args.all;
            }
        }
        typeOrField._auth = this.args;
    }

}


module.exports = {
    Auth,
};
