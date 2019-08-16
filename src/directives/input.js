const {SchemaDirectiveVisitor} = require('graphql-tools');
const {
    isInputType, getNamedType, getNullableType,
    GraphQLList, GraphQLNonNull,
    GraphQLInputObjectType, GraphQLObjectType,
} = require('graphql');

const config = require('../config');


function ensureInputType(schema, typeName, suffix, mode) {
    const inputTypeName = `${typeName}${suffix}Input`;
    let inputType = schema.getType(inputTypeName);
    if (!inputType) {
        inputType = new GraphQLInputObjectType({
            name: inputTypeName,
            fields: {}
        });
        inputType._augmentType = 'input.type';
        inputType._augmentedTypeName = typeName;
        inputType._augmentedMode = mode;
        schema.getTypeMap()[inputTypeName] = inputType;
    }
    return inputType;
}


function visitFieldDefinition(mode, prefix, schema, args, field, details) {
    if (details.objectType === schema.getQueryType()) {
        throw new Error(`directive "@${mode}" should not be used on root query fields`);
    }
    if (details.objectType === schema.getMutationType()) {
        throw new Error(`directive "@${mode}" should not be used on root mutation fields`);
    }
    const inputTypeFields = ensureInputType(schema, details.objectType.name, prefix, mode).getFields();
    const fieldType = getNamedType(field.type);
    const augment = {
        name: field.name,
        description: field.description,
    };
    if (isInputType(fieldType)) {
        augment._augmentType = 'input.field';
        augment._augmentedField = field.name;
        augment.type = getNullableType(field.type);
    } else if ((fieldType instanceof GraphQLObjectType)) {
        let augType = ensureInputType(schema, fieldType.name, prefix, mode);
        if (args.key) {
            const subField = fieldType.getFields()[args.key];
            if (!subField) {
                throw new Error(`field "${args.key}" does not exist in type "${fieldType.name}"`);
            }
            augType = getNullableType(subField.type);
            if (augType instanceof GraphQLList || !isInputType(augType)) {
                throw new Error(`field "${args.key}" in type "${fieldType.name}" as an input key needs to be of a scalar type`);
            }
            augment._augmentType = 'input.nestedKey';
            augment._augmentedObjectTypeName = augType.name;
            augment._augmentedTypeName = augType._augmentedTypeName;
            augment._augmentedKey = args.key;
            augment._augmentedField = field.name;
        } else {
            augment._augmentType = 'input.nested';
            augment._augmentedField = field.name;
        }
        const nullableFieldType = getNullableType(field.type);
        if (nullableFieldType instanceof GraphQLList) {
            if (nullableFieldType.ofType instanceof GraphQLNonNull) {
                augType = new GraphQLNonNull(augType);
            }
            augType = new GraphQLList(augType);
        }
        augment.type = augType;
    } else {
        throw new Error(`field ${field.name} cannot be processed as ${mode}`);
    }
    if (args.required === undefined && field.type instanceof GraphQLNonNull || args.required) {
        augment.type = new GraphQLNonNull(augment.type);
    }
    inputTypeFields[augment.name] = augment;
    let mutationType = schema.getMutationType();
    if (!mutationType) {
        return;
    }
    const mutationName = `${prefix}${details.objectType.name}`;
    let mutationField = mutationType.getFields()[mutationName];
    if (!mutationField) {
        return;
    }
    mutationField.args.push({...augment, type: getNullableType(augment.type)});
}



class Insert extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        return visitFieldDefinition(config.MODE_INSERT, config.FIELD_PREFIX_INSERT, this.schema, this.args, field, details);
    }

}


class Update extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        return visitFieldDefinition(config.MODE_UPDATE, config.FIELD_PREFIX_UPDATE, this.schema, this.args, field, details);
    }

}


class Upsert extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        return visitFieldDefinition(config.MODE_UPSERT, config.FIELD_PREFIX_UPSERT, this.schema, this.args, field, details);
    }

}


module.exports = {
    Insert,
    Update,
    Upsert,

    ensureInputType,
};