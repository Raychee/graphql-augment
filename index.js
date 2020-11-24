const {GraphQLDateTime} = require('graphql-iso-date');
const {GraphQLJSON, GraphQLJSONObject} = require('graphql-type-json');

const {Query, makeQueryDirective} = require('./lib/directives/query');
const {Insert, Update, Upsert, Remove, Mutation, makeMutationDirective} = require('./lib/directives/mutation');
const {Jwt} = require('./lib/directives/jwt');
const {AugmentedArgResolver} = require('./lib/resolver');
const {Response} = require('./lib/utils');
const config = require('./lib/config');


module.exports = {
    GraphQLDateTime, GraphQLJSON, GraphQLJSONObject,
    
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
            jwt: Jwt,
        };
        for (const mode of config.EXTRA_QUERY_MODES) {
            directives[mode] = makeQueryDirective(mode);
        }
        for (const mode of config.EXTRA_MUTATE_MODES) {
            directives[mode] = makeMutationDirective(mode);
        }
        return directives;
    },

    AugmentedArgResolver,
    Response,
};
