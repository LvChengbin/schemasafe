'use strict'

const genfun = require('./generate-function')
const { buildSchemas } = require('./pointer')
const { compile } = require('./compile')
const functions = require('./scope-functions')

const validator = (schema, { jsonCheck = false, isJSON = false, schemas, ...opts } = {}) => {
  if (jsonCheck && isJSON) throw new Error('Can not specify both isJSON and jsonCheck options')
  const options = { ...opts, schemas: buildSchemas(schemas || []), isJSON: isJSON || jsonCheck }
  const scope = Object.create(null)
  const actualValidate = compile(schema, schema, options, scope)
  if (!jsonCheck || opts.dryRun) return actualValidate

  // jsonCheck wrapper implementation below
  scope.deepEqual = functions.deepEqual
  scope.actualValidate = actualValidate
  const fun = genfun()
  fun.write('function validate(data) {')
  if (opts.includeErrors) {
    fun.write('if (!deepEqual(data, JSON.parse(JSON.stringify(data)))) {')
    fun.write('validate.errors = [{schemaPath:"#",dataPath:"#",message:"not JSON compatible"}]')
    fun.write('return false')
    fun.write('}')
    fun.write('const res = actualValidate(data)')
    fun.write('validate.errors = actualValidate.errors')
    fun.write('return res')
  } else {
    fun.write('return deepEqual(data, JSON.parse(JSON.stringify(data))) && actualValidate(data)')
  }
  fun.write('}')

  const validate = fun.makeFunction(scope)
  validate.toModule = () => fun.makeModule(scope)
  validate.toJSON = () => schema
  return validate
}

const parser = function(schema, opts = {}) {
  // strong mode is default in parser
  if (functions.hasOwn(opts, 'jsonCheck') || functions.hasOwn(opts, 'isJSON'))
    throw new Error('jsonCheck and isJSON options are not applicable in parser mode')
  const validate = validator(schema, { mode: 'strong', ...opts, jsonCheck: false, isJSON: true })
  const parse = opts.includeErrors
    ? (src) => {
        if (typeof src !== 'string') return { valid: false, message: 'Input is not a string' }
        try {
          const value = JSON.parse(src)
          if (!validate(value)) {
            const { schemaPath, dataPath } = validate.errors[0]
            const keyword = schemaPath.slice(schemaPath.lastIndexOf('/') + 1)
            const message = `JSON validation failed for ${keyword} at ${dataPath}`
            return { valid: false, message, errors: validate.errors }
          }
          return { valid: true, value }
        } catch ({ message }) {
          return { valid: false, message }
        }
      }
    : (src) => {
        if (typeof src !== 'string') return { valid: false }
        try {
          const value = JSON.parse(src)
          if (!validate(value)) return { valid: false }
          return { valid: true, value }
        } catch (e) {
          return { valid: false }
        }
      }
  parse.toModule = () =>
    [
      '(function(src) {',
      `const validate = ${validate.toModule()}`,
      `const parse = ${parse}\n`,
      'return parse(src)',
      '});',
    ].join('\n')
  return parse
}

module.exports = { validator, parser }
