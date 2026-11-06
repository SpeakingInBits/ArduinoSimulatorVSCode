# Forces garbage collection while C code is holding Python objects only in local variables.
# If the collector cannot see those locals, objects are freed while in use and this fails.
import gc


class Node:
    def __init__(self, value, next_node):
        self.value = value
        self.next_node = next_node


def collect_then(value):
    gc.collect()
    return value


rounds = 0
for round_number in range(150):
    head = None
    for i in range(40):
        head = Node("value-%d" % i, head)

    table = {}
    for i in range(25):
        table["key-%d" % i] = [str(i) * 3 for _ in range(4)]

    # sorted() holds its list in C while the key function runs a collection.
    items = sorted(["item-%d" % i for i in range(20)], key=collect_then)

    # join() and the comprehensions hold partial results in C across allocations.
    joined = ",".join([collect_then("part-%d" % i) for i in range(10)])
    pairs = dict(zip(["a%d" % i for i in range(10)], map(collect_then, range(10))))
    nested = tuple(tuple(collect_then(str(j)) for j in range(3)) for _ in range(5))

    try:
        raise ValueError("error-%d" % collect_then(round_number))
    except ValueError as error:
        assert str(error) == "error-%d" % round_number

    node, expected = head, 39
    while node is not None:
        assert node.value == "value-%d" % expected, node.value
        node, expected = node.next_node, expected - 1
    assert expected == -1
    for i in range(25):
        assert table["key-%d" % i] == [str(i) * 3] * 4
    assert len(items) == 20 and items[0] == "item-0"
    assert joined.split(",")[9] == "part-9"
    assert pairs["a7"] == 7
    assert nested[4][2] == "2"
    rounds += 1
    # Keeping these for the next round would need about twice the M0's memory.
    head = table = items = joined = pairs = nested = node = None

print("GC_STRESS_PASSED", rounds, "rounds, free", gc.mem_free())
