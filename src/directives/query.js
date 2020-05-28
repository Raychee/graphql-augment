const {SchemaDirectiveVisitor} = require('graphql-tools');
const {
    isInputType, getNamedType, GraphQLList,
    GraphQLInputObjectType, GraphQLObjectType, GraphQLEnumType,
} = require('graphql');

const config = require('../config');


function getEligibleOperators(type) {
    let typeName = type.name;
    if (type instanceof GraphQLEnumType) typeName = 'Enum';
    return config.DEFAULT_OPERATORS[typeName] || [];
}


function ensureQueryInputType(schema, typeName) {
    const filterInputTypeName = `${typeName}${config.MODE_QUERY[0].toUpperCase()}${config.MODE_QUERY.slice(1)}Input`;
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


function getFieldAugments(schema, field) {
    const fieldType = getNamedType(field.type);
    const augments = [];
    if (isInputType(fieldType)) {
        let operators = field._augmentQuery.op || getEligibleOperators(fieldType);
        if (field._augmentQuery.opExtend) {
            operators = [...operators, ...field._augmentQuery.opExtend];
        }
        if (field._augmentQuery.opExclude) {
            operators = operators.filter(op => !field._augmentQuery.opExclude.includes(op));
        }
        for (const operator of operators) {
            const filterInputTypeFieldName = operator === 'is' ?
                field.name : `${field.name}_${operator}`;
            const inputTypeFieldType = ['in', 'not_in'].indexOf(operator) >= 0 ?
                new GraphQLList(fieldType) : fieldType;
            augments.push({
                name: filterInputTypeFieldName,
                type: inputTypeFieldType,
                _augmentType: 'filter.operator', 
                _augmentedField: field.name, 
                _augmentedOperator: operator
            });
        }
    } else if (fieldType instanceof GraphQLObjectType) {
        augments.push({
            name: field.name,
            type: ensureQueryInputType(schema, fieldType.name),
            _augmentType: 'filter.nested', 
            _augmentedField: field.name
        });
    }
    return augments;
}

function augmentQueryField(field, augments) {
    for (const augment of augments) {
        if (field.args.every(a => a.name !== augment.name)) {
            field.args.push(augment);
        }
    }
}


class Query extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        if (details.objectType === this.schema.getQueryType()) {
            if (!this.args.type) {
                throw new Error(`directive "@${config.MODE_QUERY}" must specify "type" when used on root query fields`);
            }
            const existing = Object.values(this.schema.getQueryType().getFields())
                .find(field => field._augmentedQueryTarget === this.args.type);
            if (existing) {
                throw new Error(`directive "@${config.MODE_QUERY}" should be used on only 1 root query field for type "${this.args.type}"`);
            }
            field._augmentedQueryTarget = this.args.type;
            for (const fn of (this.schema._augmentQueryTypeDelayed || {})[this.args.type] || []) {
                fn(field);
            }
            for (const fn of field._augmentDelayed || []) {
                fn();
            }
            return;
        }
        if (details.objectType === this.schema.getMutationType()) {
            throw new Error(`directive "@${config.MODE_QUERY}" should not be used on root mutation fields`);
        }
        field._augmentQuery = this.args;
        const augments = getFieldAugments(this.schema, field);
        const filterInputType = ensureQueryInputType(this.schema, details.objectType.name);
        const filterInputTypeFields = filterInputType.getFields();
        for (const augment of augments) {
            if (!(augment.name in filterInputTypeFields)) {
                filterInputTypeFields[augment.name] = augment;
            }
        }
        const queryField = Object.values(this.schema.getQueryType().getFields())
            .find(field => field._augmentedQueryTarget === details.objectType.name);
        if (queryField) {
            augmentQueryField(queryField, augments)
        } else {
            if (!this.schema._augmentQueryTypeDelayed) {
                this.schema._augmentQueryTypeDelayed = {};
            }
            if (!this.schema._augmentQueryTypeDelayed[details.objectType.name]) {
                this.schema._augmentQueryTypeDelayed[details.objectType.name] = [];
            }
            this.schema._augmentQueryTypeDelayed[details.objectType.name].push(
                field => augmentQueryField(field, augments)
            );
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
    getFieldAugments,
};
