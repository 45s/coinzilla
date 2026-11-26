import { describe, expect, it } from 'vitest';
import { validateScenarioInput } from './validate-scenario-input';

const schema = {
  type: 'object' as const,
  required: ['minProfit'],
  additionalProperties: false,
  properties: {
    minProfit: { type: 'string', pattern: '^[0-9]+(?:[.][0-9]+)?$' },
  },
};

describe('validateScenarioInput', () => {
  it('accepts schema-valid JSON input', () => {
    expect(validateScenarioInput({
      schema,
      input: { minProfit: '0.01' },
    })).toEqual({ valid: true, errors: [] });
  });

  it('rejects missing fields, unexpected fields and malformed decimals', () => {
    expect(validateScenarioInput({
      schema,
      input: { minProfit: 'invalid', other: '1' },
    })).toEqual({
      valid: false,
      errors: [
        'Unknown input field: other',
        'Input field minProfit does not match its schema pattern',
      ],
    });
    expect(validateScenarioInput({
      schema,
      input: {},
    })).toEqual({
      valid: false,
      errors: ['Missing required input field: minProfit'],
    });
  });

  it('rejects non-object input', () => {
    expect(validateScenarioInput({
      schema,
      input: null,
    })).toEqual({
      valid: false,
      errors: ['Scenario input must be a JSON object.'],
    });
  });

  it('enforces exclusive decimal lower bounds without floating-point conversion', () => {
    const positiveSchema = {
      ...schema,
      properties: {
        minProfit: {
          ...schema.properties.minProfit,
          exclusiveMinimum: '0',
        },
      },
    }
    expect(validateScenarioInput({
      schema: positiveSchema,
      input: { minProfit: '0.0000000000000000001' },
    })).toEqual({ valid: true, errors: [] })
    expect(validateScenarioInput({
      schema: positiveSchema,
      input: { minProfit: '0' },
    })).toEqual({
      valid: false,
      errors: ['Input field minProfit must be greater than 0'],
    })
  });

});