const debug = require('debug')('graphql-augment:utils');
const {AuthenticationError, ForbiddenError} = require('apollo-server-errors');
const jwt = require('jsonwebtoken');
const {parseResolveInfo} = require('graphql-parse-resolve-info');
const {GraphQLList, GraphQLNonNull, GraphQLInputObjectType, GraphQLObjectType} = require('graphql');
const config = require('./config');


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


function parseReturnFields(info) {
    function _parse({fieldsByTypeName}) {
        const [field] = Object.values(fieldsByTypeName);
        if (field) {
            return Object.fromEntries(Object.entries(field).map(([fname, f]) => [fname, _parse(f)]));
        } else {
            return true;
        }
    }
    
    const ret = _parse(parseResolveInfo(info));
    if (typeof ret === 'object' && ret) {
        return ret;
    }
}



function sidecar(obj, extra, key= '_augmentedSidecar') {
    if (Array.isArray(obj)) {
        return obj.map(o => sidecar(o, extra, key));
    } else if (obj instanceof Date) {
        return obj;
    } else if (typeof obj === 'object' && obj && obj.constructor === Object) {
        return new Proxy(obj, {
            get(target, p, receiver) {
                if (p === key) {
                    return extra;
                } else {
                    const v = Reflect.get(target, p, receiver);
                    return sidecar(v);
                }
            }
        });
    } else {
        return obj;
    }
}


function capitalize(str) {
    return `${str[0].toUpperCase()}${str.slice(1)}`;
}


function typeToString(type) {
    if (type instanceof GraphQLList) {
        return `[${typeToString(type.ofType)}]`;
    } else if (type instanceof GraphQLNonNull) {
        return `${typeToString(type.ofType)}!`;
    } else {
        return type.name;
    }
}


function ensureInputType(schema, typeName, mode) {
    const inputTypeName = `${typeName}${capitalize(mode)}Input`;
    let inputType = schema.getType(inputTypeName);
    if (!inputType) {
        inputType = new GraphQLInputObjectType({
            name: inputTypeName,
            fields: {}
        });
        inputType._augmentType = 'type.input';
        inputType._augmentedTypeName = typeName;
        inputType._augmentedMode = mode;
        schema.getTypeMap()[inputTypeName] = inputType;
    }
    return inputType;
}

function ensureResultType(schema, typeName, mode) {
    const resultTypeName = `${typeName}${capitalize(mode)}${capitalize(config.MODE_RESULT)}`;
    let resultType = schema.getType(resultTypeName);
    if (!resultType) {
        resultType = new GraphQLObjectType({
            name: resultTypeName,
            fields: {}
        });
        resultType._augmentType = 'type.result';
        resultType._augmentedTypeName = typeName;
        resultType._augmentedMode = mode;
        schema.getTypeMap()[resultTypeName] = resultType;
    }
    return resultType;
}

function wrapNonNullAndListType(targetNamedType, referenceType) {
    if (referenceType instanceof GraphQLList) {
        return GraphQLList(wrapNonNullAndListType(targetNamedType, referenceType.ofType));
    } else if (referenceType instanceof GraphQLNonNull) {
        return GraphQLNonNull(wrapNonNullAndListType(targetNamedType, referenceType.ofType));
    } else {
        return targetNamedType;
    }
}

function isRootType(type, schema) {
    return type === schema.getQueryType() || type === schema.getMutationType();
}

function findRootTypeFieldForAugmentedTarget(schema, type, mode) {
    return [
        ...Object.values(schema.getQueryType().getFields()),
        ...(schema.getMutationType() ? Object.values(schema.getMutationType().getFields()) : []),
    ].filter(field => {
        if (!field._augmentedTarget) return false;
        return field._augmentedTarget.type === type &&
            field._augmentedTarget.mode === mode;
    });
}

function applyOnTarget(field, fn, argsFn) {
    if (!field._augmentDelayed) {
        field._augmentDelayed = [];
    }
    field._augmentDelayed.push({fn, argsFn});
    ensureApplyOnTarget(field);
}

function ensureApplyOnTarget(field) {
    const remains = [];
    for (const delayed of field._augmentDelayed || []) {
        const {fn, argsFn} = delayed;
        const args = argsFn(field);
        let keep = true;
        if (args) {
            keep = fn(args);
        }
        if (keep) {
            remains.push(delayed);
        }
    }
    delete field._augmentDelayed;
    if (remains.length > 0) {
        field._augmentDelayed = remains;
    }
}

function applyOnRootTypeFieldByTypeMode(schema, type, mode, fn) {
    applyOnTarget(
        schema, 
        (fields) => fields.forEach(f => fn(f)), 
        () => {
            const fields = findRootTypeFieldForAugmentedTarget(schema, type, mode);
            return fields.length > 0 ? fields : undefined;
        }
    );
}

function augmentFieldArgs(field, augments) {
    if (!field.args) {
        field.args = [];
    }
    for (const augment of augments) {
        if (field.args.every(a => a.name !== augment.name)) {
            debug('augment field arg: %s(%s: %s)', field.name, augment.name, typeToString(augment.type));
            field.args.push(augment);
        }
    }
}

function augmentTypeField(type, field, schema) {
    const typeFields = type.getFields();
    const augmented = {
        args: [], isDeprecated: field.deprecationReason != null,
        ...(type._augmentType === 'type.result' ? {
            resolve(...args) {
                const originalType = schema.getType(type._augmentedTypeName);
                const originalTypeField = originalType.getFields()[field.name];
                return originalTypeField.resolve(...args);
            }
        } : {}),
        ...field,
    };
    typeFields[field.name] = augmented;
    return augmented;
}

function augmentInputTypeField(type, field) {
    const inputFields = type.getFields();
    inputFields[field.name] = field;
    return field;
}


class Response {
    async results() {}
    async cursor() {}
    async count() {}
    async debug() {}
}

Response.from = async function(resolvers) {
    return new CompoundResponse(resolvers);
}


class SimpleResponse extends Response {

    constructor(resolveFns, ctxs, jwt, options) {
        super();
        this.resolveFns = resolveFns;
        this.ctxs = ctxs;
        this.jwt = jwt;
        this.options = options;

        this._resolving = undefined;
        this._results = undefined;
        this._cursor = undefined;
        this._count = undefined;
        this._debug = undefined;
    }

    async _resolve() {
        if (this.resolveFns.return && this._resolving === undefined) {
            this._resolving = this.resolveFns.return(this.ctxs, this.options).then(returned => {
                this._results = returned && returned.results;
                this._count = returned && returned.count;
                this._cursor = returned && returned.cursor;
                this._debug = returned && returned.debug;
            });
        }
        if (this._resolving) {
            await this._resolving;
        }
    }

    async results() {
        if (this._results === undefined) {
            await this._resolve();
        }
        if (this._results === undefined && this.resolveFns.results) {
            this._results = await this.resolveFns.results(this.ctxs, this.options);
        }
        return this._results;
    }

    async cursor() {
        if (this._cursor === undefined) {
            await this._resolve();
        }
        return this._cursor;
    }

    async count() {
        if (this._count === undefined) {
            await this._resolve();
        }
        if (this._count === undefined && this.resolveFns.count) {
            this._count = this.resolveFns.count(this.ctxs, this.options);
        }
        return this._count;
    }

    async debug() {
        if (this._debug === undefined) {
            await this._resolve();
        }
        if (this._debug === undefined && this.resolveFns.debug) {
            this._debug = await this.resolveFns.debug(this.ctxs, this.options);
        }
        return this._debug;
    }
}

class CompoundResponse extends Response {
    constructor(simpleResponses) {
        super();
        this.simpleResponses = simpleResponses;
    }

    async results() {
        for (const resolver of this.simpleResponses) {
            const ret = await resolver.results();
            if (ret !== undefined) return ret;
        }
    }

    async cursor() {
        for (const resolver of this.simpleResponses) {
            const ret = await resolver.cursor();
            if (ret !== undefined) return ret;
        }
    }

    async count() {
        for (const resolver of this.simpleResponses) {
            const ret = await resolver.count();
            if (ret !== undefined) return ret;
        }
    }

    async debug() {
        for (const resolver of this.simpleResponses) {
            const ret = await resolver.debug();
            if (ret !== undefined) return ret;
        }
    }
}



module.exports = {
    checkAuth,
    getJwtPayload,
    parseReturnFields,
    sidecar,
    capitalize,
    typeToString,
    ensureInputType,
    ensureResultType,
    wrapNonNullAndListType,
    isRootType,
    applyOnTarget,
    ensureApplyOnTarget,
    findRootTypeFieldForAugmentedTarget,
    applyOnRootTypeFieldByTypeMode,
    augmentFieldArgs,
    augmentTypeField,
    augmentInputTypeField,
    Response,
    SimpleResponse,
    CompoundResponse,
};
