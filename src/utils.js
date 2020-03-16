const {AuthenticationError, ForbiddenError} = require('apollo-server-errors');
const jwt = require('jsonwebtoken');


async function checkAuth(ctx, jwtPayload, auth, checkAuthFn, {silent, type, field, ...options} = {}) {
    if (auth) {
        let authMessage;
        if (checkAuthFn) {
            authMessage = await checkAuthFn(ctx, jwtPayload, auth, {type, field, ...options});
        } else {
            authMessage = false;
        }
        if (typeof authMessage === 'boolean' && !authMessage) {
            authMessage = ' ';
        }
        if (authMessage) {
            if (field) {
                authMessage = `field "${field.name}" of type "${type.name}" is not authorized: ${authMessage}`;
            } else if (type) {
                authMessage = `type "${type.name}" is not authorized: ${authMessage}`;
            }
            if (silent) {
                return authMessage;
            } else {
                throw new ForbiddenError(authMessage);
            }
        }
    }
}


function getJwtPayload(jwtPayload, auth, silent) {
    for (const guess of ['req', 'jwt', 'headers', 'header', 'authorization']) {
        if (typeof jwtPayload === 'object' && jwtPayload) {
            if (jwtPayload[guess]) {
                jwtPayload = jwtPayload[guess];
            }
        } else {
            break;
        }
    }
    for (const guess of ['schema', '_auth']) {
        if (typeof auth === 'object' && auth) {
            if (auth[guess]) {
                auth = auth[guess];
            }
        } else {
            break;
        }
    }
    if (typeof jwtPayload === 'string') {
        if (jwtPayload.startsWith('Bearer ')) {
            jwtPayload = jwtPayload.slice(7);
        }
        if (typeof auth === 'object' && auth && auth.secret) {
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
    } else if (typeof obj === 'object' && obj) {
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
