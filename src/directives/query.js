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
    filterInputType._augmentedMode = config.MODE_QUERY;
    return filterInputType;
}


function augmentField(schema, field) {
    const fieldType = getNamedType(field.type);
    const augments = [];
    if (isInputType(fieldType)) {
        const operators = field._augmentQuery.op || getEligibleOperators(fieldType);
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
    } else if (fieldType instanceof GraphQLObjectType) {
        augments.push({
            name: field.name,
            type: ensureQueryInputType(schema, fieldType.name),
            _augmentType: 'filter.nested', _augmentedField: field.name
        });
    }
    return augments;
}


class Query extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        if (details.objectType === this.schema.getQueryType()) {
            throw new Error(`directive "@${config.MODE_QUERY}" should not be used on root query fields`);
        }
        if (details.objectType === this.schema.getMutationType()) {
            throw new Error(`directive "@${config.MODE_QUERY}" should not be used on root mutation fields`);
        }
        field._augmentQuery = this.args;
        const augments = augmentField(this.schema, field);
        const filterInputType = ensureQueryInputType(this.schema, details.objectType.name);
        const filterInputTypeFields = filterInputType.getFields();
        for (const augment of augments) {
            if (!(augment.name in filterInputTypeFields)) {
                filterInputTypeFields[augment.name] = augment;
            }
        }
        const queryField = this.schema.getQueryType().getFields()[details.objectType.name];
        if (queryField) {
            for (const augment of augments) {
                if (queryField.args.every(a => a.name !== augment.name)) {
                    queryField.args.push(augment);
                }
            }
        }
        for (const type of Object.values(this.schema.getTypeMap())) {
            if (type instanceof GraphQLObjectType) {
                for (const typeField of Object.values(type.getFields())) {
                    if (typeField._augmentResult && getNamedType(typeField.type).name === details.objectType.name) {
                        for (const augment of augments) {
                            if (typeField.args.every(a => a.name !== augment.name)) {
                                typeField.args.push(augment);
                            }
                        }
                    }
                }
            }
        }
    }

}



module.exports = {
    Query,

    ensureQueryInputType,
    augmentField,
};