"""Run: python3 -m unittest discover -s reports/chasinbase -p 'test_*.py'"""
import unittest

import numpy as np

from optimal_strategy import CAP, FULL, NSTATES, STRIDE, Model, digits, encode, normal, verify


class StrategyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = Model()
        cls.m.load()
        cls.m.load_pool()

    def test_bellman_and_reroll_values(self):
        verify(self.m)

    def test_all_state_encodings(self):
        for s in range(NSTATES):
            self.assertEqual(encode(digits(s)), s)
        np.testing.assert_array_equal(digits(FULL), CAP)

    def test_opening_keeps_ruth_at_outfield(self):
        g = self.m.index['Yankees', '1920s']
        q, _, people, _, _ = self.m.choices(FULL, 3, g, set(), set())
        self.assertEqual(q.argmax(), 5)
        self.assertEqual(people[5]['name'], 'Babe Ruth')

    def test_drafted_ruth_is_unavailable_in_every_season(self):
        g = self.m.index['Yankees', '1920s']
        _, people = self.m.legal_wars(g, {normal('Babe Ruth')})
        self.assertNotEqual(people[5]['name'], 'Babe Ruth')

    def test_rerolls_obey_constraints_and_used_groups(self):
        g = self.m.index['Yankees', '1920s']
        banned = {g, self.m.index['Cardinals', '1920s'], self.m.index['Yankees', '1930s']}
        eligible = self.m.eligible_groups(FULL, set())
        for bit in [1, 2]:
            ids = self.m.reroll_targets(g, bit, eligible, banned)
            self.assertTrue(len(ids))
            self.assertFalse(set(ids) & banned)
            for j in ids:
                team, decade = self.m.groups[j]
                self.assertEqual(decade if bit == 1 else team, '1920s' if bit == 1 else 'Yankees')
                self.assertNotEqual(team if bit == 1 else decade, 'Yankees' if bit == 1 else '1920s')

    def test_last_slot_and_no_rerolls_takes_best_legal_player(self):
        g = self.m.index['Yankees', '1920s']
        state = int(STRIDE[0])
        q, rewards, _, _, _ = self.m.choices(state, 0, g, set(), set())
        self.assertEqual(q.argmax(), 0)
        self.assertAlmostEqual(q[0], rewards[0])
        self.assertEqual(np.isfinite(q).sum(), 1)

    def test_dh_preserves_native_slot_option(self):
        g = self.m.index['Yankees', '1920s']
        state = int(STRIDE[0] + STRIDE[8])
        q, _, _, dh, _ = self.m.choices(state, 0, g, set(), set())
        self.assertEqual(dh, 5)
        self.assertEqual(q.argmax(), 8)


if __name__ == '__main__':
    unittest.main()
