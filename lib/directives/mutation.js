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
            const fieldType = getNamedType(field.type);
            const augment = {
                name: field.name,
                description: field.description || '',
            };
            if (isInputType(fieldType)) {
                augment._augmentType = 'input.field';
                augment._augmentedField = field.name;
                augment.type = getNullableType(field.type);
            } else if (fieldType instanceof GraphQLObjectType) {
                let augType = this.ensureInputType(fieldType.name, this.args.as || this.args.argsAs);
                debug(
                    '@%s on %s.%s: ensure input type %s -> %s', mode,
                    details.objectType.name, field.name, fieldType.name, augType.name
                );
                augment._augmentType = 'input.nested';
                augment._augmentedField = field.name;
                if (this.args.key) {
                    augment._augmentType = 'input.nestedKey';
                    augment._augmentedObjectTypeName = augType.name;
                    augment._augmentedTypeName = augType._augmentedTypeName;
                    augment._augmentedKey = this.args.key;
                    const subField = fieldType.getFields()[this.args.key];
                    if (!subField) {
                        throw new Error(`field ${fieldType.name}.${this.args.key} does not exist`);
                    }
                    augType = getNullableType(subField.type);
                    if (augType instanceof GraphQLList || !isInputType(augType)) {
                        throw new Error(
                            `field ${fieldType.name}.${this.args.key} as an input key ` + 
                            `needs to be of a scalar type`
                        );
                    }
                }
                augment.type = getNullableType(wrapNonNullAndListType(augType, field.type));
            } else {
                throw new Error(`field ${details.objectType.name}.${field.name} cannot be processed by @${mode}`);
            }
            if (
                this.args.required == null ?
                    mode === config.MODE_INSERT && field.type instanceof GraphQLNonNull :
                    this.args.required
            ) {
                augment.type = GraphQLNonNull(augment.type);
            }
            debug(
                '@%s on %s.%s: augment arg prepare (%s: %s)', this.getAugmentMode(),
                details.objectType.name, field.name, 
                augment.name, typeToString(augment.type)
            );
            return [augment];
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
