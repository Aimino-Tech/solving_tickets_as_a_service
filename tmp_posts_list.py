import subprocess
import json
import time
import sys

# All post URLs from the twitter-campaign sheet
posts = [
    {"content_id": "TW001", "url": "https://x.com/makarandutpat/status/2064687216174285260"},
    {"content_id": "TW002", "url": "https://x.com/CorpusIQ/status/2064696415889379605"},
    {"content_id": "TW004", "url": "https://x.com/David/status/2064939160876491046"},
    {"content_id": "TW005", "url": "https://x.com/DrSirajDokadia/status/2064936536488149035"},
    {"content_id": "TW006", "url": "https://x.com/jianw851/status/2064743391678828860"},
    {"content_id": "TW007", "url": "https://x.com/johnpauldooga/status/2065010736871391247"},
    {"content_id": "TW008", "url": "https://x.com/0xdeger/status/2064996321292161110"},
    {"content_id": "TW009", "url": "https://x.com/PaulBujak/status/2064238462476103748"},
    {"content_id": "TW010", "url": "https://x.com/ConorBronsdon/status/2065288433715847526"},
    {"content_id": "TW011a", "url": "https://x.com/shiffgil/status/2065299404534243614"},
    {"content_id": "TW011b", "url": "https://x.com/waldekm/status/2066517442600243596"},
    {"content_id": "TW012", "url": "https://x.com/AzureCosmosDB/status/2066762698872725633"},
    {"content_id": "TW013", "url": "https://x.com/manishlad008/status/2066724936966934805"},
    {"content_id": "TW014", "url": "https://x.com/sobczak_mariusz/status/2066732475053699161"},
    {"content_id": "TW015", "url": "https://x.com/anoopjoes/status/2066775418942939273"},
    {"content_id": "TW016", "url": "https://x.com/khanna2402/status/2066774912132628561"},
    {"content_id": "TW017", "url": "https://x.com/HashteeLab/status/2066788695991271584"},
    {"content_id": "TW018", "url": "https://x.com/AzureCosmosDB/status/2066762698872725633"},
    {"content_id": "TW019", "url": "https://x.com/trishlaostwal/status/2066880035751936115"},
    {"content_id": "TW020a", "url": "https://x.com/101babich/status/2066857464855695657"},
    {"content_id": "TW021a", "url": "https://x.com/efipm/status/2066870166567207344"},
    {"content_id": "TW022a", "url": "https://x.com/lyrie_ai/status/2067121619110117770"},
    {"content_id": "TW023a", "url": "https://x.com/policylayer_dan/status/2067121954646020408"},
    {"content_id": "TW024", "url": "https://x.com/subham11/status/2067112361161593305"},
    {"content_id": "TW025", "url": "https://x.com/JFrogSecurity/status/2067125614096662735"},
    {"content_id": "TW026", "url": "https://x.com/stheismann/status/2066975472894796001"},
    {"content_id": "TW027", "url": "https://x.com/rohanpaul_ai/status/2066899870070292674"},
    {"content_id": "TW028", "url": "https://x.com/r0dth/status/2066980199531704518"},
    {"content_id": "TW020b", "url": "https://x.com/RituWithAI/status/2060957388937519600"},
    {"content_id": "TW021b", "url": "https://x.com/TheYotg/status/2046172781922975747"},
    {"content_id": "TW022b", "url": "https://x.com/jerryjliu0/status/1920268578898825590"},
    {"content_id": "TW023b", "url": "https://x.com/v_shakthi/status/2067067633388974460"},
    {"content_id": "TW033", "url": "https://x.com/fsiemanym/status/2067245162821247418"},
    {"content_id": "TW034", "url": "https://x.com/OdedTsamir/status/2067243698530771452"},
    {"content_id": "TW035", "url": "https://x.com/RupaTiwari82008/status/2067471300868849788"},
]

print(f"Total posts to check: {len(posts)}")
print(json.dumps(posts, indent=2))
