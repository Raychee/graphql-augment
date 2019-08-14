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


const ALL_AUTH_PREFIXES = {
    query: config.FIELD_PREFIX_QUERY,
    insert: config.FIELD_PREFIX_INSERT,
    update: config.FIELD_PREFIX_UPDATE,
    upsert: config.FIELD_PREFIX_UPSERT,
    result: config.FIELD_PREFIX_RESULT,
};


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
                if (!extra.checked) extra.checked = {};
                if (!extra.checked[type.name]) {
                    extra.checked[type.name] = {};
                    const typeAuth = type._auth && type._auth[config.FIELD_PREFIX_RESULT];
                    await checkAuth(jwtPayload, typeAuth, checkAuthFn, type, undefined, 'resolve', args[0]);
                }
                if (!extra.checked[type.name][field.name]) {
                    extra.checked[type.name][field.name] = checkAuth(
                        jwtPayload, field._auth[config.FIELD_PREFIX_RESULT], checkAuthFn,
                        type, field.name, 'resolve', args[0], field._authSilent
                    );
                }
                const message = await extra.checked[type.name][field.name];
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
        typeOrField._auth = {};
        if (this.args.all) {
            for (const p of Object.keys(ALL_AUTH_PREFIXES)) {
                this.args[p] = this.args.all;
            }
        }
        for (const [p, prefix] of Object.entries(ALL_AUTH_PREFIXES)) {
            if (this.args[p]) {
                typeOrField._auth[prefix] = this.args[p];
                typeOrField._authSilent = this.args.silent;
            }
        }
    }

}


module.exports = {
    Auth,
};