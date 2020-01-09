const {SchemaDirectiveVisitor} = require('graphql-tools');
const {
    GraphQLBoolean, GraphQLString, GraphQLList, GraphQLNonNull, GraphQLInputObjectType,
} = require('graphql');

const config = require('../config');


function augmentField(schema, field) {
    const existingArgs = new Set(field.args.map(a => a.name));
    const sortInputTypeName = `${config.ARG_NAME_SORT}Input`;
    let sortInputType = schema.getType(sortInputTypeName);
    if (!sortInputType) {
        sortInputType = new GraphQLInputObjectType({
            name: sortInputTypeName,
            fields: {
                by: {type: new GraphQLNonNull(GraphQLString), description: '需要排序的字段'},
                desc: {type: GraphQLBoolean, defaultValue: false, description: '降序为true，默认为false'}
            }
        });
        sortInputType._augmentType = 'sort.inputType';
        schema.getTypeMap()[sortInputTypeName] = sortInputType;
    } else if (!sortInputType._augmentType) {
        return;
    }
    const arg = {
        name: config.ARG_NAME_SORT, type: new GraphQLList(new GraphQLNonNull(sortInputType)), _augmentType: 'sort.sort'
    };
    if (!existingArgs.has(config.ARG_NAME_SORT)) {
        field.args.push(arg);
    }
}


class Sort extends SchemaDirectiveVisitor {

    visitFieldDefinition(field, details) {
        if (details.objectType === this.schema.getMutationType()) {
            throw new Error('directive "@sort" should not be used on root mutation field definitions');
        }
        field._augmentSort = true;
        if (details.objectType === this.schema.getQueryType() || field._augmentResult) {
            augmentField(this.schema, field);
        }
    }

}


module.exports = {
    Sort,
};