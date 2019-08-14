const {SchemaDirectiveVisitor} = require('graphql-tools');
const {GraphQLInt} = require('graphql');

const config = require('../config');


class Page extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        if (details.objectType !== this.schema.getQueryType()) {
            throw new Error('directive "@pageable" should only be used on root query field definitions');
        }
        if (!this.schema.getType(field.name)) {
            throw new Error(`directive "@pageable" used on field "${field.name}" which does not match any of the existing types`);
        }
        // const filterInputType = ensureFilterInputType(this.schema, field.name);
        // const filterInputTypeFields = filterInputType.getFields();
        const existingArgs = new Set(field.args.map(a => a.name));
        if (!existingArgs.has(config.ARG_NAME_PAGE)) {
            field.args.push({
                name: config.ARG_NAME_PAGE, type: GraphQLInt, defaultValue: 1, _augmentType: 'filter.pagination'
            });
        }
        if (!existingArgs.has(config.ARG_NAME_PAGESIZE)) {
            field.args.push({
                name: config.ARG_NAME_PAGESIZE,
                type: GraphQLInt,
                defaultValue: this.args.size >= 0 ? this.args.size : 1,
                _augmentType: 'filter.pagination'
            });
        }
    }

}


module.exports = {
    Page,
};