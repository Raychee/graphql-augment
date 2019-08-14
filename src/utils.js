const {AuthenticationError} = require('apollo-server-errors');
const jwt = require('jsonwebtoken');


async function checkAuth(jwtPayload, auth, checkAuthFn, type, field, mode, args, silent) {
    if (auth) {
        let authMessage;
        if (checkAuthFn) {
            authMessage = await checkAuthFn(jwtPayload, auth, type, field, mode, args);
        } else {
            authMessage = false;
        }
        if (typeof authMessage === 'boolean' && !authMessage) {
            authMessage = ' ';
        }
        if (authMessage) {
            if (field) {
                authMessage = `field "${field}" of type "${type.name}" is not authorized: ${authMessage}`;
            } else {
                authMessage = `type "${type.name}" is not authorized: ${authMessage}`;
            }
            if (silent) {
                return authMessage;
            } else {
                throw new AuthenticationError(authMessage);
            }
        }
    }
}


function getJwtPayload(jwtPayload, schema, silent) {
    if (typeof jwtPayload === 'object' && jwtPayload && jwtPayload.req) {
        jwtPayload = jwtPayload.req;
    }
    if (typeof jwtPayload === 'object' && jwtPayload && jwtPayload.headers) {
        jwtPayload = jwtPayload.headers.authorization;
    }
    if (typeof jwtPayload === 'string' && jwtPayload.startsWith('Bearer ')) {
        jwtPayload = jwtPayload.slice(7);
    }
    if (typeof jwtPayload === 'string') {
        if (schema.schema) {
            schema = schema.schema;
        }
        if (schema && schema._auth) {
            const {secret, options} = schema._auth;
            try {
                jwtPayload = jwt.verify(jwtPayload, secret, options);
            } catch (e) {
                if (!silent) {
                    throw new AuthenticationError(`authentication failed: ${e}`);
                } else {
                    jwtPayload = undefined;
                }
            }
        } else {
            jwtPayload = undefined;
        }
    } else {
        jwtPayload = undefined;
    }
    return jwtPayload;
}


function sideCar(obj, extra, key) {
    key = key || '_extra';
    return new Proxy(obj, {
        get(target, p, receiver) {
            if (p === key) {
                return extra;
            } else {
                const v = Reflect.get(target, p, receiver);
                if (typeof v === 'object' && v.constructor === Object) {
                    return sideCar(v, extra);
                } else {
                    return v;
                }
            }
        }
    });
}


module.exports = {
    checkAuth,
    getJwtPayload,
    sideCar,
};
