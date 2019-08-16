const {defaultFieldResolver} = require('graphql');
const {SchemaDirectiveVisitor} = require('graphql-tools');
const jwt = require('jsonwebtoken');


class Jwt extends SchemaDirectiveVisitor {

    visitFieldDefinition(field) {
        const secret = this.args.secret;
        const options = {...this.args};
        delete options.secret;
        if (!secret) {
            throw Error('@jwt secret cannot be empty');
        }
        const {resolve = defaultFieldResolver} = field;
        field.resolve = async function (...args) {
            const payload = await resolve.apply(this, args);
            if (payload) {
                return jwt.sign(payload, secret, options);
            } else {
                return "";
            }
        };
        this.schema._auth = {secret, options};
    }

}


module.exports = {
    Jwt,
};