/*!
 * Copyright 2024 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

import {
  AndCondition,
  OneOfCondition,
  EvaluationContext,
  NamedCondition,
  OrCondition,
  PercentCondition,
  PercentConditionOperator,
  CustomSignalCondition,
  CustomSignalOperator,
} from './remote-config-api';
import * as farmhash from 'farmhash-modern';
import long = require('long');

/**
 * Encapsulates condition evaluation logic to simplify organization and
 * facilitate testing.
 *
 * @internal
 */
export class ConditionEvaluator {
  private static MAX_CONDITION_RECURSION_DEPTH = 10;

  public evaluateConditions(
    namedConditions: NamedCondition[],
    context: EvaluationContext): Map<string, boolean> {
    // The order of the conditions is significant.
    // A JS Map preserves the order of insertion ("Iteration happens in insertion order"
    // - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map#description).
    const evaluatedConditions = new Map();

    for (const namedCondition of namedConditions) {
      evaluatedConditions.set(
        namedCondition.name,
        this.evaluateCondition(namedCondition.condition, context));
    }

    return evaluatedConditions;
  }

  private evaluateCondition(
    condition: OneOfCondition,
    context: EvaluationContext,
    nestingLevel = 0): boolean {
    if (nestingLevel >= ConditionEvaluator.MAX_CONDITION_RECURSION_DEPTH) {
      // TODO: add logging once we have a wrapped logger.
      return false;
    }
    if (condition.orCondition) {
      return this.evaluateOrCondition(condition.orCondition, context, nestingLevel + 1)
    }
    if (condition.andCondition) {
      return this.evaluateAndCondition(condition.andCondition, context, nestingLevel + 1)
    }
    if (condition.true) {
      return true;
    }
    if (condition.false) {
      return false;
    }
    if (condition.percent) {
      return this.evaluatePercentCondition(condition.percent, context);
    }
    if (condition.customSignal) {
      return this.evaluateCustomSignalCondition(condition.customSignal, context);
    }
    // TODO: add logging once we have a wrapped logger.
    return false;
  }

  private evaluateOrCondition(
    orCondition: OrCondition,
    context: EvaluationContext,
    nestingLevel: number): boolean {

    const subConditions = orCondition.conditions || [];

    for (const subCondition of subConditions) {
      // Recursive call.
      const result = this.evaluateCondition(
        subCondition, context, nestingLevel + 1);

      // Short-circuit the evaluation result for true.
      if (result) {
        return result;
      }
    }
    return false;
  }

  private evaluateAndCondition(
    andCondition: AndCondition,
    context: EvaluationContext,
    nestingLevel: number): boolean {

    const subConditions = andCondition.conditions || [];

    for (const subCondition of subConditions) {
      // Recursive call.
      const result = this.evaluateCondition(
        subCondition, context, nestingLevel + 1);

      // Short-circuit the evaluation result for false.
      if (!result) {
        return result;
      }
    }
    return true;
  }

  private evaluatePercentCondition(
    percentCondition: PercentCondition,
    context: EvaluationContext
  ): boolean {
    if (!context.randomizationId) {
      // TODO: add logging once we have a wrapped logger.
      return false;
    }

    // This is the entry point for processing percent condition data from the response.
    // We're not using a proto library, so we can't assume undefined fields have
    // default values.
    const { seed, percentOperator, microPercent, microPercentRange } = percentCondition;

    if (!percentOperator) {
      // TODO: add logging once we have a wrapped logger.
      return false;
    }

    const normalizedMicroPercent = microPercent || 0;
    const normalizedMicroPercentUpperBound = microPercentRange?.microPercentUpperBound || 0;
    const normalizedMicroPercentLowerBound = microPercentRange?.microPercentLowerBound || 0;

    const seedPrefix = seed && seed.length > 0 ? `${seed}.` : '';
    const stringToHash = `${seedPrefix}${context.randomizationId}`;


    // Using a 64-bit long for consistency with the Remote Config fetch endpoint.
    let hash64 = long.fromString(farmhash.fingerprint64(stringToHash).toString());

    // Negate the hash if its value is less than 0. We handle this manually because the
    // Long library doesn't provided an absolute value method.
    if (hash64.lt(0)) {
      hash64 = hash64.negate();
    }

    const instanceMicroPercentile = hash64.mod(100 * 1_000_000);

    switch (percentOperator) {
    case PercentConditionOperator.LESS_OR_EQUAL:
      return instanceMicroPercentile.lte(normalizedMicroPercent);
    case PercentConditionOperator.GREATER_THAN:
      return instanceMicroPercentile.gt(normalizedMicroPercent);
    case PercentConditionOperator.BETWEEN:
      return instanceMicroPercentile.gt(normalizedMicroPercentLowerBound)
        && instanceMicroPercentile.lte(normalizedMicroPercentUpperBound);
    case PercentConditionOperator.UNKNOWN:
    default:
      break;
    }

    // TODO: add logging once we have a wrapped logger.
    return false;
  }

  private evaluateCustomSignalCondition(
    customSignalCondition: CustomSignalCondition,
    context: EvaluationContext
  ): boolean {
    const {
      customSignalOperator,
      customSignalKey,
      targetCustomSignalValues,
    } = customSignalCondition;

    if (!customSignalOperator || !customSignalKey || !targetCustomSignalValues) {
      // TODO: add logging once we have a wrapped logger.
      return false;
    }

    if (!targetCustomSignalValues.length) {
      return false;
    }

    // Extract the value of the signal from the evaluation context.
    const actualCustomSignalValue = context[customSignalKey];

    if (actualCustomSignalValue == undefined) {
      return false
    }

    switch (customSignalOperator) {
    case CustomSignalOperator.STRING_CONTAINS:
      return compareStrings(
        targetCustomSignalValues,
        actualCustomSignalValue,
        (target, actual) => actual.includes(target),
      );
    case CustomSignalOperator.STRING_DOES_NOT_CONTAIN:
      return !compareStrings(
        targetCustomSignalValues,
        actualCustomSignalValue,
        (target, actual) => actual.includes(target),
      );
    case CustomSignalOperator.STRING_EXACTLY_MATCHES:
      return compareStrings(
        targetCustomSignalValues,
        actualCustomSignalValue,
        (target, actual) => actual.trim() === target.trim(),
      );
    case CustomSignalOperator.STRING_CONTAINS_REGEX:
      return compareStrings(
        targetCustomSignalValues,
        actualCustomSignalValue,
        (target, actual) => new RegExp(target).test(actual),
      );

    // For numeric operators only one target value is allowed.
    case CustomSignalOperator.NUMERIC_LESS_THAN:
      return compareNumbers(actualCustomSignalValue, targetCustomSignalValues[0], (r) => r < 0);
    case CustomSignalOperator.NUMERIC_LESS_EQUAL:
      return compareNumbers(actualCustomSignalValue, targetCustomSignalValues[0], (r) => r <= 0);
    case CustomSignalOperator.NUMERIC_EQUAL:
      return compareNumbers(actualCustomSignalValue, targetCustomSignalValues[0], (r) => r === 0);
    case CustomSignalOperator.NUMERIC_NOT_EQUAL:
      return compareNumbers(actualCustomSignalValue, targetCustomSignalValues[0], (r) => r !== 0);
    case CustomSignalOperator.NUMERIC_GREATER_THAN:
      return compareNumbers(actualCustomSignalValue, targetCustomSignalValues[0], (r) => r > 0);
    case CustomSignalOperator.NUMERIC_GREATER_EQUAL:
      return compareNumbers(actualCustomSignalValue, targetCustomSignalValues[0], (r) => r >= 0);

    // For semantic operators only one target value is allowed.
    case CustomSignalOperator.SEMANTIC_VERSION_LESS_THAN:
      return compareSemanticVersions(actualCustomSignalValue, targetCustomSignalValues[0], (r) => r < 0);
    case CustomSignalOperator.SEMANTIC_VERSION_LESS_EQUAL:
      return compareSemanticVersions(actualCustomSignalValue, targetCustomSignalValues[0], (r) => r <= 0);
    case CustomSignalOperator.SEMANTIC_VERSION_EQUAL:
      return compareSemanticVersions(actualCustomSignalValue, targetCustomSignalValues[0], (r) => r === 0);
    case CustomSignalOperator.SEMANTIC_VERSION_NOT_EQUAL:
      return compareSemanticVersions(actualCustomSignalValue, targetCustomSignalValues[0], (r) => r !== 0);
    case CustomSignalOperator.SEMANTIC_VERSION_GREATER_THAN:
      return compareSemanticVersions(actualCustomSignalValue, targetCustomSignalValues[0], (r) => r > 0);
    case CustomSignalOperator.SEMANTIC_VERSION_GREATER_EQUAL:
      return compareSemanticVersions(actualCustomSignalValue, targetCustomSignalValues[0], (r) => r >= 0);
    }

    // TODO: add logging once we have a wrapped logger.
    return false;
  }
}

// Compares the actual string value of a signal against a list of target
// values. If any of the target values are a match, returns true.
function compareStrings(
  targetValues: Array<string>,
  actualValue: string|number,
  predicateFn: (target: string, actual: string) => boolean
): boolean {
  const actual = String(actualValue);
  return targetValues.some((target) => predicateFn(target, actual));
}

// Compares two numbers against each other.
// Calls the predicate function with  -1, 0, 1 if actual is less than, equal to, or greater than target.
function compareNumbers(
  actualValue: string|number,
  targetValue: string,
  predicateFn: (result: number) => boolean
): boolean {
  const target = Number(targetValue);
  const actual = Number(actualValue);
  if (isNaN(target) || isNaN(actual)) {
    return false;
  }
  return predicateFn(actual < target ? -1 : actual > target ? 1 : 0);
}

// Compares semantic version strings against each other.
// Calls the predicate function with  -1, 0, 1 if actual is less than, equal to, or greater than target.
function compareSemanticVersions(
  actualValue: string|number,
  targetValue: string,
  predicateFn: (result: number) => boolean
): boolean {
  const version1 = String(actualValue).split('.').map(Number);
  const version2 = targetValue.split('.').map(Number);

  if (version1.some(isNaN) || version2.some(isNaN)) {
    return false;
  }

  for (let i = 0;; i++) {
    const version1HasSegment = version1[i] !== undefined;
    const version2HasSegment = version2[i] !== undefined;
    if (!version1HasSegment) {
      return predicateFn(version2HasSegment ? -1 : 0);
    } else if (!version2HasSegment) {
      return predicateFn(1);
    }

    if (version1[i] !== version2[i]) {
      return predicateFn(version1[i] < version2[i] ? -1 : 1);
    }
  }
}
