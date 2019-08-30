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
        field.resolve = async function (...args) {
            const extra = args[0] && args[0]._extra;
            if (extra) {
                const {jwt: jwtPayload, auth: checkAuthFn} = extra;
                // if (!extra.checked) extra.checked = {};
                // if (!extra.checked[type.name]) {
                //     extra.checked[type.name] = {};
                    const typeAuth = type._auth && type._auth[config.MODE_RESULT];
                    await checkAuth(jwtPayload, typeAuth, checkAuthFn, type, undefined, config.MODE_RESULT, args[0]);
                // }
                // if (!extra.checked[type.name][field.name]) {
                //     extra.checked[type.name][field.name] = checkAuth(
                //         jwtPayload, field._auth && field._auth[config.MODE_RESULT], checkAuthFn,
                //         type, field.name, config.MODE_RESULT, args[0], field._auth.silent
                //     );
                // }
                // const message = await extra.checked[type.name][field.name];
                const message = await checkAuth(
                    jwtPayload, field._auth && field._auth[config.MODE_RESULT], checkAuthFn,
                    type, field.name, config.MODE_RESULT, args[0], field._auth && field._auth.silent
                );
                if (message) {
                    return getDefaultValue(field.type);
                }
            }
            return resolve.apply(this, args);
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