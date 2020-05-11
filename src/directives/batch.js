const {SchemaDirectiveVisitor} = require('graphql-tools');
const {GraphQLList, GraphQLNonNull, getNamedType} = require('graphql');

const config = require('../config');
const {ensureQueryInputType} = require('./query');
const {ensureInputType} = require('./input');


function augmentField(schema, targetField, typeName) {
    if (targetField && targetField.args.every(a => a.name !== config.ARG_NAME_FILTERS)) {
        const filterInputType = ensureQueryInputType(schema, typeName);
        if (targetField._augmentBatch.includeCustomized) {
            const filterInputTypeFields = filterInputType.getFields();
            for (const arg of targetField.args) {
                if (!arg._augmentType) {
                    filterInputTypeFields[arg.name] = {
                        name: arg.name,
                        type: arg.type,
                        description: arg.description,
                        _augmentType: 'filter.customized', _augmentedArg: arg.name
                    };
                }
            }
        }
        targetField.args.push({
            name: config.ARG_NAME_FILTERS,
            type: new GraphQLList(new GraphQLNonNull(filterInputType)),
            _augmentType: 'filter.filters'
        });
    }
}


class Batch extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        field._augmentBatch = this.args;
        if (details.objectType === this.schema.getMutationType()) {
            const allPrefixes = [config.FIELD_PREFIX_INSERT, config.FIELD_PREFIX_UPDATE, config.FIELD_PREFIX_UPSERT];
            const prefix = allPrefixes.find(p => field.name.startsWith(p));
            if (!prefix) {
                throw new Error(`the root mutation fields where directive "@batch" is applied should start with any of the following: ${allPrefixes.join(', ')}`);
            }
            const typeName = field.name.slice(prefix.length);
            if (!this.schema.getType(typeName)) {
                throw new Error(`directive "@batch" used on field "${field.name}" but "${typeName}" does not match any of the existing types`);
            }
            if (field.args.every(a => a.name !== config.ARG_NAME_INPUTS)) {
                const inputType = ensureInputType(this.schema, typeName, prefix);
                if (this.args.includeCustomized) {
                    const inputTypeFields = inputType.getFields();
                    for (const arg of field.args) {
                        if (!arg._augmentType) {
                            inputTypeFields[arg.name] = {
                                name: arg.name,
                                type: arg.type,
                                description: arg.description,
                                _augmentType: 'filter.customized', _augmentedArg: arg.name
                            };
                        }
                    }
                }
                field.args.push({
                    name: config.ARG_NAME_INPUTS,
                    type: new GraphQLList(new GraphQLNonNull(inputType)),
                    _augmentType: 'input.inputs'
                })
            }
        } else {
            let targetField, typeName;
            if (details.objectType === this.schema.getQueryType()) {
                targetField = field;
                if (!field.name.startsWith(config.FIELD_PREFIX_QUERY)) {
                    throw new Error(`the root query fields where directive "@batch" is applied should start with ${config.FIELD_PREFIX_QUERY}`);
                }
                typeName = field.name.slice(config.FIELD_PREFIX_QUERY.length);
            } else if (field._augmentResult) {
                targetField = field;
                typeName = getNamedType(field.type).name;
            }
            augmentField(this.schema, targetField, typeName);
        }
    }

}


module.exports = {
    Batch,

    augmentField,
};
