"""
Characterization tests for intent classifier rule engine.
Pins current fast-path routing behavior on deterministic sample phrases (fake data).
"""

from intent_classifier import classify_intent_rules


def test_intent_email_list():
    result = classify_intent_rules("unread emails", is_self_chat=True)
    assert result is not None
    assert result["intent"] == "email_list"
    assert result["should_respond"] is True


def test_intent_briefing():
    result = classify_intent_rules("morning briefing", is_self_chat=True)
    assert result is not None
    assert result["intent"] == "briefing"
    assert result["should_respond"] is True


def test_intent_greeting():
    result = classify_intent_rules("hello", is_self_chat=True)
    assert result is not None
    assert result["intent"] == "general_qa"
    assert result["should_respond"] is True


def test_intent_search():
    result = classify_intent_rules("search latest python release", is_self_chat=True)
    assert result is not None
    assert result["intent"] == "search"
    assert result["should_respond"] is True


def test_intent_reminder():
    result = classify_intent_rules("remind me to send status report in 30 minutes", is_self_chat=True)
    assert result is not None
    assert result["intent"] == "reminder"
    assert result["should_respond"] is True


def test_intent_memory_save():
    result = classify_intent_rules("remember office parking spot is B12", is_self_chat=True)
    assert result is not None
    assert result["intent"] == "memory_save"
    assert result["should_respond"] is True


def test_intent_passive_noise_ignored():
    # Passive group message without scheduling cues should not trigger response
    result = classify_intent_rules("haha that was a hilarious joke", is_self_chat=False)
    assert result is not None
    assert result["should_respond"] is False


def test_intent_slash_commands_and_heuristics():
    # Slash commands bypass LLM
    r1 = classify_intent_rules("/todaytasks", is_self_chat=True)
    assert r1 is not None and r1["intent"] == "todo" and r1["extract_data"]["action"] == "list"

    r2 = classify_intent_rules("/status", is_self_chat=True)
    assert r2 is not None and r2["intent"] == "general_qa"

    # Maintenance & cleanup
    r3 = classify_intent_rules("clean up", is_self_chat=True)
    assert r3 is not None and r3["intent"] == "general_qa" and r3["extract_data"]["action"] == "cleanup"

    # Plan for today
    r4 = classify_intent_rules("also tell me that plan for today", is_self_chat=True)
    assert r4 is not None and r4["intent"] == "briefing"

    # Trivial acknowledgment
    r5 = classify_intent_rules("ok", is_self_chat=True)
    assert r5 is not None and r5["intent"] == "general_qa"

