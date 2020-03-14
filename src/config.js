module.exports = {

    ARG_NAME_FILTERS: 'filters',
    ARG_NAME_INPUTS: 'inputs',
    ARG_NAME_SORT: 'sort',
    ARG_NAME_LIMIT: 'limit',
    ARG_NAME_OFFSET: 'offset',
    ARG_NAME_PAGE: 'page',
    ARG_NAME_PAGESIZE: 'limit',

    FIELD_PREFIX_QUERY: '',
    FIELD_PREFIX_INSERT: 'Insert',
    FIELD_PREFIX_UPDATE: 'Update',
    FIELD_PREFIX_UPSERT: 'Upsert',
    FIELD_PREFIX_RESULT: 'Result',

    MODE_QUERY: 'query',
    MODE_INSERT: 'insert',
    MODE_UPDATE: 'update',
    MODE_UPSERT: 'upsert',
    MODE_RESULT: 'result',

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
