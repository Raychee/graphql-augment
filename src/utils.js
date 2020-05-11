const debug = require('debug')('graphql-augment:utils');
const {AuthenticationError, ForbiddenError} = require('apollo-server-errors');
const jwt = require('jsonwebtoken');


async function checkAuth(ctx, jwtPayload, checkAuthFn, {silent, type, field, ...options} = {}) {
    let authMessage;
    if (checkAuthFn) {
        authMessage = await checkAuthFn(ctx, jwtPayload, {type, field, ...options});
    } else {
        authMessage = true;
    }
    if (typeof authMessage === 'boolean') {
        authMessage = authMessage ? '' : ' ';
    }
    if (authMessage) {
        let errorType;
        if (jwtPayload) {
            if (field) {
                authMessage = `field "${field.name}" of type "${type.name}" is not authorized: ${authMessage}`;
            } else if (type) {
                authMessage = `type "${type.name}" is not authorized: ${authMessage}`;
            }
            errorType = ForbiddenError;
        } else {
            authMessage = `authentication failed: ${authMessage}`;
            errorType = AuthenticationError;
        }
        if (silent) {
            return authMessage;
        } else {
            throw new errorType(authMessage);
        }
    }
}


function getJwtPayload(jwtPayload, auth, silent) {
    debug('guess jwtPayload from %j', jwtPayload);
    for (const guess of ['req', 'jwt', 'headers', 'header', 'authorization']) {
        if (typeof jwtPayload === 'object' && jwtPayload) {
            if (jwtPayload[guess]) {
                jwtPayload = jwtPayload[guess];
            }
        } else {
            break;
        }
    }
    debug('guessed jwtPayload: %j', jwtPayload);
    debug('guess auth from %j', auth);
    for (const guess of ['schema', '_auth']) {
        if (typeof auth === 'object' && auth) {
            if (auth[guess]) {
                auth = auth[guess];
            }
        } else {
            break;
        }
    }
    debug('guessed auth: %j', auth);
    if (typeof jwtPayload === 'string') {
        if (jwtPayload.startsWith('Bearer ')) {
            jwtPayload = jwtPayload.slice(7);
        }
        if (typeof auth === 'object' && auth && auth.secret != null) {
            const {secret, options} = auth;
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


function sideCar(obj, extra, key = '_extra') {
    if (Array.isArray(obj)) {
        return obj.map(o => sideCar(o, extra, key));
    } else if (obj instanceof Date) {
        return obj;
    } else if (typeof obj === 'object' && obj && obj.constructor === Object) {
        return new Proxy(obj, {
            get(target, p, receiver) {
                if (p === key) {
                    return extra;
                } else {
                    const v = Reflect.get(target, p, receiver);
                    return sideCar(v);
                }
            }
        });
    } else {
        return obj;
    }
}


module.exports = {
    checkAuth,
    getJwtPayload,
    sideCar,
};
