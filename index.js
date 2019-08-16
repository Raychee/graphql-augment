const {UserInputError, AuthenticationError} = require('apollo-server-errors');
const {
    isInputType, getNamedType, getNullableType,
    GraphQLBoolean, GraphQLInt, GraphQLFloat, GraphQLString, GraphQLID, GraphQLList, GraphQLNonNull,
    GraphQLInputObjectType, GraphQLObjectType,
} = require('graphql');
const {GraphQLDateTime} = require('graphql-iso-date');
const {GraphQLJSON, GraphQLJSONObject} = require('graphql-type-json');

const {Query} = require('./src/directives/query');
const {Page} = require('./src/directives/page');
const {Sort} = require('./src/directives/sort');
const {Result, ResultResolver} = require('./src/directives/result');
const {Insert, Update, Upsert} = require('./src/directives/input');
const {Batch} = require('./src/directives/batch');
const {Auth} = require('./src/directives/auth');
const {Jwt} = require('./src/directives/jwt');
const {AugmentedArgResolver} = require('./src/tools');
const {checkAuth, getJwtPayload, sideCar} = require('./src/utils');
const config = require('./src/config');


module.exports = {
    makeSchemaDirectives: () => ({
        [config.MODE_QUERY]: Query,
        [config.MODE_INSERT]: Insert,
        [config.MODE_UPDATE]: Update,
        [config.MODE_UPSERT]: Upsert,
        page: Page,
        sort: Sort,
        result: Result,
        batch: Batch,
        auth: Auth,
        jwt: Jwt,
    }),

    AugmentedArgResolver,
    ResultResolver,

    config,

    checkAuth,
    getJwtPayload,
    sideCar,

    UserInputError, AuthenticationError,
    isInputType, getNamedType, getNullableType,
    GraphQLBoolean, GraphQLInt, GraphQLFloat, GraphQLString, GraphQLID,
    GraphQLDateTime, GraphQLJSON, GraphQLJSONObject,
    GraphQLInputObjectType, GraphQLObjectType,
    GraphQLList, GraphQLNonNull,
};