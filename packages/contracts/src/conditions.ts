// Moved to @nexo/domain (the lower layer) so the pure simulation engine can evaluate rules
// without importing contracts, which would be a package cycle. Re-exported here unchanged.
export { conditionMatches, CONDITION_OPERATORS, getPathValue, systemContext, type ConditionOperator, type SystemContext } from '@nexo/domain';
