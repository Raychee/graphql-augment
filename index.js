const {GraphQLDateTime} = require('graphql-iso-date');
const {GraphQLJSON, GraphQLJSONObject} = require('graphql-type-json');

const {Query} = require('./src/directives/query');
const {Page} = require('./src/directives/page');
const {Sort} = require('./src/directives/sort');
const {Result, ResultResolver} = require('./src/directives/result');
const {Insert, Update, Upsert, Remove, Mutation, makeInputDirective} = require('./src/directives/input');
const {Batch} = require('./src/directives/batch');
const {Auth} = require('./src/directives/auth');
const {Jwt} = require('./src/directives/jwt');
const {AugmentedArgResolver} = require('./src/tools');
const {checkAuth, getJwtPayload, sidecar} = require('./src/utils');
const config = require('./src/config');


module.exports = {
    setConfig: (conf) => {
        Object.assign(config, conf);
    },
    makeSchemaDirectives: () => {
        const directives = {
            [config.MODE_QUERY]: Query,
            [config.MODE_INSERT]: Insert,
            [config.MODE_UPDATE]: Update,
            [config.MODE_UPSERT]: Upsert,
            [config.MODE_REMOVE]: Remove,
            [config.MODE_MUTATE]: Mutation,
            page: Page,
            sort: Sort,
            result: Result,
            batch: Batch,
            auth: Auth,
            jwt: Jwt,
        };
        for (const mode of config.EXTRA_MUTATE_MODES) {
            directives[mode] = makeInputDirective(mode);
        }
        return directives;
    },

    AugmentedArgResolver,
    ResultResolver,

    checkAuth,
    getJwtPayload,
    sidecar,

    GraphQLDateTime, GraphQLJSON, GraphQLJSONObject,
};
