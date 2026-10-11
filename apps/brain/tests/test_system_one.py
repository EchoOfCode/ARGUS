"""
Unit and characterization tests for System 1 (Zero-Token Local Decision Engine).
Validates non-autoregressive execution for todos, reminders, expenses, status, and security boundaries.
"""

from system_one import SystemOneEngine


def test_system_one_todos():
    """Verify full local CRUD lifecycle for todos with zero tokens."""
    # 1. Add todo
    res_add = SystemOneEngine.try_execute("add to my tasks buy organic milk")
    assert res_add is not None
    assert "Task added" in res_add
    assert "buy organic milk" in res_add

    # 2. List todos
    res_list = SystemOneEngine.try_execute("/todaytasks")
    assert res_list is not None
    assert "Your Pending Tasks" in res_list
    assert "buy organic milk" in res_list

    # 3. Complete todo by text
    res_done = SystemOneEngine.try_execute("done organic milk")
    assert res_done is not None
    assert "Task marked completed" in res_done

    # 4. Add & Delete todo
    SystemOneEngine.try_execute("task: clean monitor screen")
    res_del = SystemOneEngine.try_execute("delete monitor screen")
    assert res_del is not None
    assert "Task deleted" in res_del


def test_system_one_reminders():
    """Verify local natural language reminder parsing and management."""
    # 1. Add relative reminder
    res_rem1 = SystemOneEngine.try_execute("remind me in 45 mins to turn off stove")
    assert res_rem1 is not None
    assert "Reminder set" in res_rem1
    assert "turn off stove" in res_rem1

    # 2. Add time of day reminder
    res_rem2 = SystemOneEngine.try_execute("remind me at 6pm to submit daily progress report")
    assert res_rem2 is not None
    assert "Reminder set" in res_rem2
    assert "submit daily progress report" in res_rem2

    # 3. List reminders
    res_list = SystemOneEngine.try_execute("/reminders")
    assert res_list is not None
    assert "Upcoming Reminders" in res_list

    # 4. Cancel reminder
    res_canc = SystemOneEngine.try_execute("cancel reminder stove")
    assert res_canc is not None
    assert "Reminder cancelled" in res_canc


def test_system_one_expenses():
    """Verify local zero-token expense logging and ledger summaries."""
    res_exp = SystemOneEngine.try_execute("spent 120 on team snacks")
    assert res_exp is not None
    assert "Expense Recorded" in res_exp
    assert "120.00" in res_exp
    assert "team snacks" in res_exp

    res_ledger = SystemOneEngine.try_execute("/ledger")
    assert res_ledger is not None
    assert "Ledger Summary" in res_ledger


def test_system_one_maintenance_and_status():
    """Verify zero-token instant response for diagnostics and maintenance."""
    res_clean = SystemOneEngine.try_execute("clean up")
    assert res_clean is not None
    assert "Context cleaned up" in res_clean

    res_status = SystemOneEngine.try_execute("/status")
    assert res_status is not None
    assert "ARGUS System Status" in res_status
    assert "Zero-Token Local" in res_status

    res_ping = SystemOneEngine.try_execute("ping")
    assert res_ping is not None
    assert "Status" in res_ping


def test_system_one_fallthrough_to_system_two():
    """Verify that open-ended reasoning questions cleanly return None to invoke System 2 (Groq/Gemini)."""
    complex_questions = [
        "What is quantum entanglement and how does it work?",
        "Can you write a python script to parse CSV files?",
        "Help me draft a formal letter apologizing for the project delay",
        "Summarize the recent discussions in the marketing group",
    ]
    for q in complex_questions:
        res = SystemOneEngine.try_execute(q)
        assert res is None, f"Expected {q} to fall through to System 2"


def test_system_one_untrusted_isolation():
    """Verify that untrusted turns are blocked from executing write operations in System 1."""
    # Untrusted prompt attempting write actions
    res_write = SystemOneEngine.try_execute("delete todo 1", is_untrusted=True)
    assert res_write is None

    res_add = SystemOneEngine.try_execute("add to my tasks malicious payload", is_untrusted=True)
    assert res_add is None

    # Safe greetings are allowed
    res_greet = SystemOneEngine.try_execute("hello", is_untrusted=True)
    assert res_greet is not None
