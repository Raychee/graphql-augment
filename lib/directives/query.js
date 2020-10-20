const debug = require('debug')('graphql-augment:directives/query');
const {
    isInputType, getNamedType, GraphQLList, GraphQLNonNull,
    GraphQLObjectType, GraphQLEnumType,
} = require('graphql');

const config = require('../config');
const {SchemaAugmenter} = require('./common');
const {typeToString} = require('../utils');


function getEligibleOperators(type) {
    let typeName = type.name;
    if (type instanceof GraphQLEnumType) typeName = 'Enum';
    return config.DEFAULT_OPERATORS[typeName] || [];
}


function makeQueryDirective(mode) {

    return class extends SchemaAugmenter {
        
        getAugmentMode() {
            return mode;
        }
        
        getArgNameForBatch() {
            return config.ARG_NAME_FILTERS;
        }
        
        getAugmentTypeForBatch() {
            return 'filter.filters';
        }

        getFieldAugments(field, details) {
            const fieldType = getNamedType(field.type);
            const augments = [];
            if (isInputType(fieldType)) {
                const {op, opInclude, opExclude, required} = this.args;
                let operators = op || getEligibleOperators(fieldType);
                if (opInclude) {
                    operators = [...operators, ...opInclude];
                }
                if (opExclude) {
                    operators = operators.filter(op => !opExclude.includes(op));
                }
                for (const operator of operators) {
                    const inputFieldName = operator === 'is' ?
                        field.name : `${field.name}_${operator}`;
                    const inputFieldType = ['in', 'not_in'].indexOf(operator) >= 0 ?
                        GraphQLList(fieldType) : fieldType;
                    debug(
                        '@%s on %s.%s: augment arg prepare (%s: %s)', this.getAugmentMode(), 
                        details.objectType.name, field.name, 
                        inputFieldName, typeToString(inputFieldType)
                    );
                    augments.push({
                        name: inputFieldName,
                        type: required ? GraphQLNonNull(inputFieldType) : inputFieldType,
                        description: field.description || '',
                        _augmentType: 'filter.operator',
                        _augmentedField: field.name,
                        _augmentedOperator: operator
                    });
                }
            } else if (fieldType instanceof GraphQLObjectType) {
                const {as, argsAs, required} = this.args;
                const type = this.ensureInputType(fieldType.name, as || argsAs);
                debug(
                    '@%s on %s.%s: ensure input type %s -> %s', this.getAugmentMode(), 
                    details.objectType.name, field.name, fieldType.name, type.name
                );
                augments.push({
                    name: field.name, 
                    type: required ? GraphQLNonNull(type) : type,
                    description: field.description || '',
                    args: [],
                    _augmentType: 'filter.nested',
                    _augmentedField: field.name
                });
            } else {
                throw new Error(`field ${details.objectType.name}.${field.name} cannot be processed by @${mode}`);
            }
            return augments;
        }
        
    };

}



module.exports = {
    Query: makeQueryDirective(config.MODE_QUERY),

    makeQueryDirective,
};
