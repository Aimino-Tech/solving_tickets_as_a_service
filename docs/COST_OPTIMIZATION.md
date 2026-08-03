# Cost Optimization Plan

> **Objective**: Reduce per-fix inference and sandbox costs to achieve healthy unit economics across all tiers.

## Current State

| Cost Component | Current Cost/Fix | Target Cost/Fix | Savings |
|---|---|---|---|
| Inference (OpenCode + frontier model) | ~$3.00 | ~$1.50 | 50% |
| Sandbox compute | ~$0.50 | ~$0.20 | 60% |
| **Total** | **~$3.50** | **~$1.70** | **51%** |

## 1. Inference Caching Strategy

### 1.1 Prompt/Response Cache (Redis)
- **Cache key**: `syntaro:cache:inference:{model}:{prompt-hash}`
- **TTL**: 7 days (frequently repeated triage patterns)
- **Hit rate target**: 20-30% for triage phase
- **Implementation**: Wrap all OpenCode calls with a cache-aside pattern

### 1.2 Semantic Cache (Vector DB)
- **Cache key**: Embedding similarity > 0.95 on triage prompts
- **TTL**: 30 days
- **Hit rate target**: 10-15% additional on top of exact cache
- **Implementation**: Store embeddings in Redis with RediSearch vector index

### 1.3 Context Window Optimization
- **Truncation**: Cap issue context at 8K tokens (most issues < 4K)
- **Selective inclusion**: Only include relevant files (skip `node_modules`, `dist/`, lock files)
- **Chunking**: Split large repos into chunks, only send relevant chunks to model

## 2. Prompt Optimization

### 2.1 Tiered Prompt Strategy
| Phase | Current Cost | Optimized Cost | Technique |
|---|---|---|---|
| Triage | ~$0.50 | ~$0.10 | Use `gpt-4o-mini` for classification |
| Investigation | ~$2.00 | ~$1.00 | Shorter system prompt, fewer context files |
| Fix generation | ~$3.00 | ~$2.00 | Focused diff generation, not full file rewrites |
| Test generation | ~$1.00 | ~$0.50 | Use model with best code understanding |

### 2.2 Prompt Compression
- **System prompt compression**: Reduce from ~2K tokens to ~500 tokens
- **Few-shot pruning**: Remove lowest-value examples
- **Dynamic prompt assembly**: Only include relevant instructions based on detected issue type

### 2.3 Model Cascade
```
Triage: gpt-4o-mini ($0.15/1M tokens)
  → Investigation: claude-sonnet-4 ($3/1M tokens)
    → Fix generation: claude-sonnet-4 or gpt-4o ($3-10/1M tokens)
      → Test generation: gpt-4o-mini ($0.15/1M tokens)
```

## 3. Model Selection Strategy

### 3.1 Default Model Stack
| Role | Model | Cost/1M Tokens | When |
|---|---|---|---|
| Classifier | `gpt-4o-mini` | $0.15 | Always for triage |
| Investigator | `claude-sonnet-4-20250514` | $3.00 | Default for investigation |
| Fix generator | `claude-sonnet-4-20250514` | $3.00 | Default for code changes |
| Test writer | `gpt-4o-mini` | $0.15 | Default for test generation |

### 3.2 Fallback Chain
```
claude-sonnet-4 → gpt-4o → claude-haiku
```
Each fallback is ~50% cheaper but may have lower pass rate.

### 3.3 Model Routing per Issue Type
| Issue Type | Recommended Model | Rationale |
|---|---|---|
| Bug fix | claude-sonnet-4 | Best code understanding |
| Feature request | gpt-4o | Better at following specs |
| Documentation | gpt-4o-mini | Simple text generation |
| Refactoring | claude-sonnet-4 | Complex code transformation |
| Dependency update | claude-haiku | Simple, well-defined |

## 4. Volume Discounts

| Monthly Volume | Expected Discount | Negotiation Target |
|---|---|---|
| 0-1,000 fixes | 0% (retail) | — |
| 1,000-10,000 fixes | 15-25% | API provider volume tier |
| 10,000-100,000 fixes | 30-50% | Custom enterprise agreement |
| 100,000+ fixes | 50-70% | Dedicated infra + batch pricing |

## 5. Monitoring & Targets

| Metric | Current | 30-Day Target | 90-Day Target |
|---|---|---|---|
| Avg inference cost/fix | $3.00 | $2.50 | $1.50 |
| Cache hit rate | 0% | 20% | 40% |
| Sandbox cost/fix | $0.50 | $0.35 | $0.20 |
| Average model tokens/fix | 15K | 10K | 7K |
| Fallback rate | 0% | <5% | <5% |
