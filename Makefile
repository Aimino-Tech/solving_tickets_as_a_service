# STAS — Development & Benchmark Makefile

.PHONY: help setup-tabpfn benchmark-tabpfn benchmark-tabpfn-all benchmark-compare

help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

setup-tabpfn:  ## Set up TabPFN Python environment
	bash scripts/setup-tabpfn.sh

benchmark-tabpfn:  ## Run TabPFN comparison benchmark (first 5 datasets for quick test)
	python workers/benchmark/tabpfn_comparison.py --datasets 5 --export benchmarks/tabpfn-comparison.json

benchmark-tabpfn-all:  ## Run TabPFN comparison on all 30+ OpenML-CC18 datasets
	python workers/benchmark/tabpfn_comparison.py --export benchmarks/tabpfn-comparison.json

benchmark-tabpfn-verbose:  ## Run TabPFN comparison with verbose output
	python workers/benchmark/tabpfn_comparison.py --datasets 5 --export benchmarks/tabpfn-comparison.json --verbose

benchmark-compare:  ## Compare TabPFN results with baseline
	@echo "Comparing with baseline..."
	@if [ -f benchmarks/tabpfn-comparison.json ]; then \
		python -c "import json; d=json.load(open('benchmarks/tabpfn-comparison.json')); s=d.get('summary',{}); [print(f'{k}: acc={v[\"mean_accuracy\"]:.4f} ± {v[\"std_accuracy\"]:.4f}') for k,v in s.items()]"; \
	else \
		echo "No benchmark results found. Run 'make benchmark-tabpfn' first."; \
	fi
