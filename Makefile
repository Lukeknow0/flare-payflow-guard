SHELL := /bin/sh

NODE ?= node
NPM ?= npm
PYTHON ?= python3
PYTHONPATH_LOCAL := $(CURDIR)/src
T1_RUN_1 ?= evidence/live/runs/t1-run-1.json
T1_RUN_2 ?= evidence/live/runs/t1-run-2.json

.PHONY: doctor test-node test-python verify-t1 demo-pass demo-review demo-block verify-offline verify-live verify

doctor:
	@$(NODE) -e 'const major=Number(process.versions.node.split(".")[0]); if (major < 20) { throw new Error(`Node >=20 required, found $${process.version}`); } console.log(`doctor node=$${process.version}`);'
	@$(NODE) --input-type=module -e 'await import("viem"); await import("@flarenetwork/flare-wagmi-periphery-package"); console.log("doctor node_dependencies=ok");'
	@$(NPM) ls --depth=0 >/dev/null
	@echo "doctor dependency_tree=ok"
	@PYTHONPATH="$(PYTHONPATH_LOCAL):$${PYTHONPATH:-}" $(PYTHON) -c 'import sys; import flare_guard; assert sys.version_info >= (3, 10), sys.version; print("doctor python=" + sys.version.split()[0])'
	@test -f "$(T1_RUN_1)" && test -f "$(T1_RUN_2)"
	@echo "doctor evidence_bundles=ok"

test-node:
	$(NODE) --test tests/node/*.test.mjs

test-python:
	PYTHONPATH="$(PYTHONPATH_LOCAL):$${PYTHONPATH:-}" $(PYTHON) -m unittest discover -s tests/python -v

verify-t1:
	$(NODE) scripts/verify-t1-spikes.mjs "$(T1_RUN_1)" "$(T1_RUN_2)"

demo-pass:
	$(PYTHON) scripts/run-fixture-demo.py --fixture fixtures/demo-pass.json --expected PASS

demo-review:
	$(PYTHON) scripts/run-fixture-demo.py --fixture fixtures/demo-review.json --expected REVIEW

demo-block:
	$(PYTHON) scripts/run-fixture-demo.py --fixture fixtures/demo-block.json --expected BLOCK

verify-offline: doctor test-node test-python verify-t1 demo-pass demo-review demo-block
	@echo '{"mode":"offline","status":"VERIFY_OFFLINE_PASS"}'

verify-live:
	$(NODE) scripts/verify-live.mjs

verify: verify-offline verify-live
	@echo '{"status":"VERIFY_PASS"}'
