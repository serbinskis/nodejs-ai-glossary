import xml.etree.ElementTree as ET
import json
import html
import re
import os

xml_files = ["Glossary.xml", "Vardnica.xml"]

def clean_text(text):
    if not text: return ""
    text = html.unescape(text)
    text = re.sub(r'<[^>]+>', '', text)
    return text.strip()

def extract_english_prefix(text):
    if not text.startswith("(angļu val."): return text, None

    open_parens = 0
    for i, char in enumerate(text):
        if char == "(":
            open_parens += 1
        elif char == ")":
            open_parens -= 1
            if open_parens == 0:
                english_text = text[len("(angļu val."):i].strip()
                main_text = text[i+1:].strip()
                return main_text, english_text
    return text, None

def xml_to_json(filename):
    tree = ET.parse(filename)
    root = tree.getroot()

    data = {}
    info_elem = root.find('INFO')
    if info_elem is not None:
        info = {
            "name": clean_text(info_elem.findtext('NAME')),
            "intro": clean_text(info_elem.findtext('INTRO')),
            "introFormat": int(info_elem.findtext('INTROFORMAT', 1)),
            "allowDuplicatedEntries": info_elem.findtext('ALLOWDUPLICATEDENTRIES') == "1",
            "displayFormat": clean_text(info_elem.findtext('DISPLAYFORMAT')),
            "showSpecial": info_elem.findtext('SHOWSPECIAL') == "1",
            "showAlphabet": info_elem.findtext('SHOWALPHABET') == "1",
            "showAll": info_elem.findtext('SHOWALL') == "1",
            "allowComments": info_elem.findtext('ALLOWCOMMENTS') == "1",
            "useDynaLink": info_elem.findtext('USEDYNALINK') == "1",
            "defaultApproval": info_elem.findtext('DEFAULTAPPROVAL') == "1",
            "globalGlossary": info_elem.findtext('GLOBALGLOSSARY') == "1",
            "entriesPerPage": int(info_elem.findtext('ENTBYPAGE', 10))
        }
        data["info"] = info

        entries_elem = info_elem.find('ENTRIES')
        entries = []
        if entries_elem is not None:
            for entry in entries_elem.findall('ENTRY'):
                concept = clean_text(entry.findtext('CONCEPT'))
                definition_raw = clean_text(entry.findtext('DEFINITION'))
                definition, english = extract_english_prefix(definition_raw)
                entry_data = {"term": concept, "definition": definition}
                if english: entry_data["english_term"] = english
                entries.append(entry_data)
        entries.sort(key=lambda x: x["term"].lower())
        data["entries"] = entries

    return data

for xml_file in xml_files:
    json_data = xml_to_json(xml_file)
    json_filename = os.path.splitext(xml_file)[0] + ".json"
    with open(json_filename, "w", encoding="utf-8") as f:
        json.dump(json_data, f, ensure_ascii=False, indent=2)
    print(f"Converted {xml_file} -> {json_filename}")