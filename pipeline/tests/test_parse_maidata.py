import unittest

from tools.parse_maidata import parse_maidata_text


class ParseMaidataTests(unittest.TestCase):
    def test_parse_basic_metadata_and_difficulty(self) -> None:
        text = """&title=バベル
&artist=いよわ feat. 重音テト
&version=maimai DX PRiSM
&genre=重音テトコラボちほー
&wholebpm=225
&first=0
&shortid=620
&lv_5=13+
&des_5=サファ太
&inote_5=(225){4},1,2,3,4
"""
        parsed = parse_maidata_text(text)
        self.assertEqual(parsed["title"], "バベル")
        self.assertEqual(parsed["artist"], "いよわ feat. 重音テト")
        self.assertEqual(parsed["version"], "maimai DX PRiSM")
        self.assertEqual(parsed["genre"], "重音テトコラボちほー")
        self.assertEqual(parsed["bpm"], 225.0)
        self.assertEqual(parsed["offset"], 0.0)
        self.assertEqual(parsed["short_id"], "620")
        self.assertEqual(parsed["difficulties"][0]["slot"], 5)
        self.assertEqual(parsed["difficulties"][0]["level"], "13+")
        self.assertEqual(parsed["difficulties"][0]["designer"], "サファ太")

    def test_parse_supports_key_variants(self) -> None:
        text = """&title=Test Song
&engartist=Artist EN
&engtitle=Test Song EN
&whole_bpm=180
&des5=Example Charter
&lv_5=12
&inote_5=(180){4},1,1,1,1
"""
        parsed = parse_maidata_text(text)
        self.assertEqual(parsed["title_en"], "Test Song EN")
        self.assertEqual(parsed["artist_en"], "Artist EN")
        self.assertEqual(parsed["bpm"], 180.0)
        self.assertEqual(parsed["difficulties"][0]["designer"], "Example Charter")


if __name__ == "__main__":
    unittest.main()
