module.exports = {

    ARG_NAME_FILTERS: 'filters',
    ARG_NAME_INPUTS: 'inputs',
    ARG_NAME_SORT: 'sort',
    ARG_NAME_PAGE: 'page',
    ARG_NAME_PAGESIZE: 'limit',
    ARG_NAME_CURSOR: 'cursor',
    
    FIELD_NAME_RESULTS: 'results',
    FIELD_NAME_CURSOR: 'cursor',
    FIELD_NAME_COUNT: 'count',
    FIELD_NAME_DEBUG: 'debug',

    MODE_QUERY: 'query',
    MODE_MUTATE: 'mutate',
    MODE_INSERT: 'insert',
    MODE_UPDATE: 'update',
    MODE_UPSERT: 'upsert',
    MODE_REMOVE: 'remove',
    MODE_RESULT: 'result',
    EXTRA_MUTATE_MODES: [],

    DEFAULT_OPERATORS: {
        Boolean: ['is'],
        Float: ['is', 'not', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte'],
        Int: ['is', 'not', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte'],
        String: ['is', 'not', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'regex', 'not_regex'],
        ID: ['is', 'not', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'regex', 'not_regex'],
        Enum: ['is', 'not', 'in', 'not_in'],
        JSONObject: ['is'],
        DateTime: ['is', 'not', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte'],
    },

};
