const {SchemaDirectiveVisitor} = require('graphql-tools');
const {GraphQLInt} = require('graphql');

const config = require('../config');


function augmentField(field) {
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
            defaultValue: field._augmentPage.size >= 0 ? field._augmentPage.size : 1,
            _augmentType: 'filter.pagination'
        });
    }
}

class Page extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        if (details.objectType === this.schema.getMutationType()) {
            throw new Error('directive "@page" should not be used on root mutation field definitions');
        }
        field._augmentPage = this.args;
        if (details.objectType === this.schema.getQueryType() || field._augmentResult) {
            augmentField(field);
        }
    }

}


module.exports = {
    Page,

    augmentField,
};