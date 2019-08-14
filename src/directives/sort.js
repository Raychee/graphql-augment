const {SchemaDirectiveVisitor} = require('graphql-tools');
const {
    GraphQLBoolean, GraphQLString, GraphQLList, GraphQLNonNull, GraphQLInputObjectType,
} = require('graphql');

const config = require('../config');


class Sort extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        if (details.objectType !== this.schema.getQueryType()) {
            throw new Error('directive "@sortable" should only be used on root query field definitions');
        }
        if (!this.schema.getType(field.name)) {
            throw new Error(`directive "@sortable" used on field "${field.name}" which does not match any of the existing types`);
        }
        const existingArgs = new Set(field.args.map(a => a.name));
        const sortInputTypeName = `${config.ARG_NAME_SORT}Input`;
        let sortInputType = this.schema.getType(sortInputTypeName);
        if (!sortInputType) {
            sortInputType = new GraphQLInputObjectType({
                name: sortInputTypeName,
                fields: {
                    by: {type: new GraphQLNonNull(GraphQLString), description: '需要排序的字段'},
                    desc: {type: GraphQLBoolean, defaultValue: false, description: '降序为true，默认为false'}
                }
            });
            sortInputType._augmentType = 'sort.inputType';
            this.schema.getTypeMap()[sortInputTypeName] = sortInputType;
        } else if (!sortInputType._augmentType) {
            return;
        }
        const arg = {
            name: config.ARG_NAME_SORT, type: new GraphQLList(new GraphQLNonNull(sortInputType)), _augmentType: 'sort.sort'
        };
        if (!existingArgs.has(config.ARG_NAME_SORT)) {
            field.args.push(arg);
        }
        // const filterInputType = ensureFilterInputType(this.schema, field.name);
        // const filterInputTypeFields = filterInputType.getFields();
        // if (!(sortArgName in filterInputTypeFields)) {
        //     filterInputTypeFields[sortArgName] = arg;
        // }
    }

}


module.exports = {
    Sort,
};