const debug = require('debug')('graphql-augment:directives/mutation');
const {
    isInputType, getNamedType, getNullableType,
    GraphQLList, GraphQLNonNull, GraphQLObjectType,
} = require('graphql');

const config = require('../config');
const {SchemaAugmenter} = require('./common');
const {wrapNonNullAndListType, typeToString} = require("../utils");


function makeMutationDirective(mode) {
    
    return class extends SchemaAugmenter {

        getAugmentMode() {
            return mode;
        }

        getArgNameForBatch() {
            return config.ARG_NAME_INPUTS;
        }

        getAugmentTypeForBatch() {
            return 'input.inputs';
        }

        getFieldAugments(field, details) {
            const fieldNamedType = getNamedType(field.type);
            const augments = [];
            const {op, opInclude, opExclude, required} = this.args;
            let operators = op || ['is'];
            if (opInclude) {
                operators = [...operators, ...opInclude];
            }
            if (opExclude) {
                operators = operators.filter(op => !opExclude.includes(op));
            }
            for (const operator of operators) {
                const inputFieldName = operator === 'is' ?
                    field.name : `${field.name}_${operator}`;
                const augment = {
                    name: inputFieldName,
                    description: field.description || '',
                    _augmentedField: field.name,
                    _augmentedOperator: operator,
                };
                let inputFieldType;
                if (isInputType(fieldNamedType)) {
                    inputFieldType = getNullableType(field.type);
                    augment._augmentType = 'input.field';
                } else if (fieldNamedType instanceof GraphQLObjectType) {
                    const augType = this.ensureInputType(fieldNamedType.name, this.args.as || this.args.argsAs);
                    debug(
                        '@%s on %s.%s: ensure input type %s -> %s', mode,
                        details.objectType.name, field.name, fieldNamedType.name, augType.name
                    );
                    inputFieldType = getNullableType(wrapNonNullAndListType(augType, field.type));
                    augment._augmentType = 'input.nested';
                    if (this.args.key) {
                        augment._augmentType = 'input.nestedKey';
                        augment._augmentedObjectTypeName = augType.name;
                        augment._augmentedTypeName = augType._augmentedTypeName;
                        augment._augmentedKey = this.args.key;
                        const subField = fieldNamedType.getFields()[this.args.key];
                        if (!subField) {
                            throw new Error(`field ${fieldNamedType.name}.${this.args.key} does not exist`);
                        }
                        inputFieldType = getNullableType(subField.type);
                        if (inputFieldType instanceof GraphQLList || !isInputType(inputFieldType)) {
                            throw new Error(
                                `field ${fieldNamedType.name}.${this.args.key} as an input key ` +
                                `needs to be of a scalar type`
                            );
                        }
                    }
                } else {
                    throw new Error(`field ${details.objectType.name}.${field.name} cannot be processed by @${mode}`);
                }
                const isNonNull = required == null ?
                    mode === config.MODE_INSERT && field.type instanceof GraphQLNonNull && operator === 'is' :
                    required;
                inputFieldType = isNonNull ? GraphQLNonNull(inputFieldType) : inputFieldType;
                augment.type = inputFieldType;
                debug(
                    '@%s on %s.%s: augment arg prepare (%s: %s)', this.getAugmentMode(),
                    details.objectType.name, field.name,
                    augment.name, typeToString(augment.type)
                );
                augments.push(augment);
            }
            return augments;
        }

    };
    
}


module.exports = {
    Insert: makeMutationDirective(config.MODE_INSERT),
    Update: makeMutationDirective(config.MODE_UPDATE),
    Upsert: makeMutationDirective(config.MODE_UPSERT),
    Remove: makeMutationDirective(config.MODE_REMOVE),
    Mutation: makeMutationDirective(config.MODE_MUTATE),

    makeMutationDirective,
};
