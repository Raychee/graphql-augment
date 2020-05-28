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


function augmentMutationField(field, schema) {
    const {type, mode} = field._augmentedMutationTarget;
    if (!schema.getType(type)) {
        throw new Error(`directive "@batch" used on field "${field.name}" but "${type}" does not match any of the existing types`);
    }
    if (field.args.every(a => a.name !== config.ARG_NAME_INPUTS)) {
        const inputType = ensureInputType(this.schema, type, mode);
        if (field._augmentBatch.includeCustomized) {
            const inputTypeFields = inputType.getFields();
            for (const arg of field.args) {
                if (!arg._augmentType) {
                    inputTypeFields[arg.name] = {
                        name: arg.name,
                        type: arg.type,
                        description: arg.description,
                        _augmentType: 'filter.customized', 
                        _augmentedArg: arg.name
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
}


class Batch extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        field._augmentBatch = this.args;
        if (details.objectType === this.schema.getMutationType()) {
            if (field._augmentedMutationTarget) {
                augmentMutationField(field, this.schema);
            } else {
                if (!field._augmentDelayed) {
                    field._augmentDelayed = [];
                }
                field._augmentDelayed.push(() => augmentMutationField(field, this.schema));
            }
        } else {
            let targetField, typeName;
            if (details.objectType === this.schema.getQueryType()) {
                if (field._augmentedQueryTarget) {
                    augmentField(this.schema, field, field._augmentedQueryTarget);
                } else {
                    if (!field._augmentDelayed) {
                        field._augmentDelayed = [];
                    }
                    field._augmentDelayed.push(() => augmentField(this.schema, field, field._augmentedQueryTarget));
                }
            } else if (field._augmentResult) {
                targetField = field;
                typeName = getNamedType(field.type).name;
                augmentField(this.schema, targetField, typeName);
            }
        }
    }

}


module.exports = {
    Batch,

    augmentField,
};
