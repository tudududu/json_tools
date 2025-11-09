# Simple Makefile for tests and coverage

.PHONY: test coverage pytest-cov clean

TEST_CMD=python3 python/run_tests.py

# Run unittest suite
test:
	$(TEST_CMD)

# Run unittest suite with coverage and produce reports/badge
coverage:
	# Ensure coverage directory exists and remove stale badge to avoid overwrite errors
	mkdir -p python/tests/coverage
	rm -f python/tests/coverage/coverage.svg
	$(TEST_CMD) --coverage

# Run pytest with pytest-cov (requires pytest-cov installed)
pytest-cov:
	pytest --cov=python --cov-branch --cov-config=.coveragerc \
		--cov-report=term-missing \
		--cov-report=xml:python/tests/coverage/coverage.xml \
		--cov-report=html:python/tests/coverage/html

clean:
	rm -rf python/tests/coverage htmlcov .coverage coverage.xml coverage.json
