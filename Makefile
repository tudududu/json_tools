.PHONY: test test-cov-term test-cov-xml

PY ?= .venv/bin/python3

test:
	$(PY) -m pytest -q

test-cov-term:
	$(PY) -m pytest --cov=python --cov-branch --cov-report=term --cov-config=.coveragerc

# Useful for CI-like local runs to refresh coverage.xml
test-cov-xml:
	$(PY) -m pytest --cov=python --cov-branch --cov-report=xml:python/tests/coverage/coverage.xml --cov-config=.coveragerc
# Simple Makefile for tests and coverage

.PHONY: test coverage pytest-cov clean

TEST_CMD=python3 python/run_tests.py

# Run unittest suite
test:
	$(TEST_CMD)

# Run unittest suite with coverage and produce reports/badge
coverage:
	COVERAGE=1 $(TEST_CMD)

# Run pytest with pytest-cov (requires pytest-cov installed)
pytest-cov:
	pytest --cov=python --cov-branch --cov-config=.coveragerc \
		--cov-report=term-missing \
		--cov-report=xml:python/tests/coverage/coverage.xml \
		--cov-report=html:python/tests/coverage/html

clean:
	rm -rf python/tests/coverage htmlcov .coverage coverage.xml coverage.json
