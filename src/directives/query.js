const {SchemaDirectiveVisitor} = require('graphql-tools');
const {
    isInputType, getNamedType,
    GraphQLBoolean, GraphQLInt, GraphQLFloat, GraphQLString, GraphQLID, GraphQLList,
    GraphQLInputObjectType, GraphQLObjectType,
} = require('graphql');
const {GraphQLDateTime} = require('graphql-iso-date');
const {GraphQLJSONObject} = require('graphql-type-json');

const config = require('../config');


function getEligibleOperators(type) {
    const operators = ['is'];
    if ([GraphQLBoolean, GraphQLJSONObject].map(t => t.name).indexOf(type.name) < 0) {
        operators.push('not', 'in', 'not_in');
    }
    if ([GraphQLFloat, GraphQLInt, GraphQLString, GraphQLID, GraphQLDateTime].map(t => t.name).indexOf(type.name) >= 0) {
        operators.push('gt', 'gte', 'lt', 'lte');
    }
    if ([GraphQLString, GraphQLID].map(t => t.name).indexOf(type.name) >= 0) {
        operators.push('regex', 'not_regex');
    }
    return operators;
}


function ensureQueryInputType(schema, typeName) {
    const filterInputTypeName = `${typeName}${config.FIELD_PREFIX_QUERY}Input`;
    let filterInputType = schema.getType(filterInputTypeName);
    if (!filterInputType) {
        filterInputType = new GraphQLInputObjectType({
            name: filterInputTypeName,
            fields: {}
        });
        schema.getTypeMap()[filterInputTypeName] = filterInputType;
    }
    filterInputType._augmentType = 'filter.type';
    filterInputType._augmentedTypeName = typeName;
    filterInputType._augmentedMode = config.FIELD_PREFIX_QUERY;
    return filterInputType;
}


class Query extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        if (details.objectType === this.schema.getQueryType()) {
            throw new Error(`directive "@query" should not be used on root query fields`);
        }
        if (details.objectType === this.schema.getMutationType()) {
            throw new Error(`directive "@query" should not be used on root mutation fields`);
        }
        const filterInputType = ensureQueryInputType(this.schema, details.objectType.name);
        const filterInputTypeFields = filterInputType.getFields();
        const fieldType = getNamedType(field.type);
        const augments = [];
        if (isInputType(fieldType)) {
            const operators = this.args.op || getEligibleOperators(fieldType);
            for (const operator of operators) {
                const filterInputTypeFieldName = operator === 'is' ?
                    field.name : `${field.name}_${operator}`;
                const inputTypeFieldType = ['in', 'not_in'].indexOf(operator) >= 0 ?
                    new GraphQLList(fieldType) : fieldType;
                augments.push({
                    name: filterInputTypeFieldName,
                    type: inputTypeFieldType,
                    _augmentType: 'filter.operator', _augmentedField: field.name, _augmentedOperator: operator
                });
            }
        } else if ((fieldType instanceof GraphQLObjectType)) {
            augments.push({
                name: field.name,
                type: ensureQueryInputType(this.schema, fieldType.name),
                _augmentType: 'filter.nested', _augmentedField: field.name
            });
        }
        for (const augment of augments) {
            if (!(augment.name in filterInputTypeFields)) {
                filterInputTypeFields[augment.name] = augment;
            }
        }
        const queryField = this.schema.getQueryType().getFields()[details.objectType.name];
        if (!queryField) {
            return;
        }
        for (const augment of augments) {
            queryField.args.push(augment);
        }
    }

}



module.exports = {
    Query,

    ensureQueryInputType,
};