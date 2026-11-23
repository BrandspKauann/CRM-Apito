"""Vincula contatos do CRM por domínio. Simula por padrão; --apply persiste a revisão."""
import argparse
import collections
import csv
import hashlib
import io
import json
import re
import subprocess
import unicodedata
import urllib.request
from urllib.parse import urlsplit


SOURCES = {
    "psl": "https://publicsuffix.org/list/public_suffix_list.dat",
    "free": "https://raw.githubusercontent.com/willwhite/freemail/master/data/free.txt",
    "disposable": "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf",
}
EXTRA = set("""uol.com.br bol.com.br terra.com.br ig.com.br ibest.com.br igmail.com.br
globo.com globomail.com r7.com zipmail.com.br oi.com.br brturbo.com.br
superig.com.br click21.com.br gmail.com googlemail.com hotmail.com outlook.com
live.com msn.com yahoo.com ymail.com rocketmail.com icloud.com me.com mac.com
proton.me protonmail.com pm.me tutanota.com tuta.com fastmail.com mail.com aol.com
privaterelay.appleid.com onmicrosoft.com exemplo.com.br example.com
example.net example.org apitodemestre.com.br""".split())
PROVIDER_STEMS = set("gmail gmai gmal gmial gmil gemail gmaill gmaol hotmail hotmial hotmal hotmil hotmai hotmaill homail hotimail hotnail htomail outlook outlok outllook outloook yahoo yaho yahho yhaoo ymail icloud terra uol bol ig live msn googlemail".split())
LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")
EMAIL = re.compile(r"[^@<>\s,;]+@([^@<>\s,;]+)")


def host(value):
    try:
        ascii_name = value.lower().encode("idna").decode("ascii")
    except UnicodeError:
        return ""
    if len(ascii_name) <= 253 and all(LABEL.fullmatch(x) for x in ascii_name.split(".")):
        return ascii_name
    return ""


class Rules:
    def __init__(self):
        self.blocked = EXTRA.copy()
        self.suffix, self.wildcard, self.exceptions, self.private = set(), set(), set(), set()
        self.hashes = {}
        self.counts = {}
        for name, url in SOURCES.items():
            with urllib.request.urlopen(url, timeout=30) as response:
                data = response.read(5_000_001)
            if len(data) > 5_000_000:
                raise ValueError("Lista de domínios excedeu o limite")
            self.hashes[name] = hashlib.sha256(data).hexdigest()
            lines = data.decode().splitlines()
            if name != "psl":
                domains = {host(x.strip()) for x in lines if x.strip() and not x.startswith("#")}
                domains.discard("")
                self.counts[name] = len(domains)
                self.blocked.update(domains)
                continue
            private = False
            for line in lines:
                if "BEGIN PRIVATE DOMAINS" in line:
                    private = True
                if not line.strip() or line.startswith("//"):
                    continue
                rule = line.strip()
                target = self.wildcard if rule.startswith("*.") else self.exceptions if rule.startswith("!") else self.suffix
                domain = host(rule.removeprefix("*.").removeprefix("!"))
                target.add(domain)
                if private:
                    self.private.add(domain)
        self.counts["psl"] = sum(map(len,(self.suffix,self.wildcard,self.exceptions)))
        if any(self.counts[k]<v for k,v in {"psl":7000,"free":3000,"disposable":3000}.items()):
            raise ValueError("Listas de domínios incompletas: " + str(self.counts))
        if "com.br" not in self.suffix or "github.io" not in self.private:
            raise ValueError("Regras PSL inválidas")

    def classify(self, value):
        h = host(value)
        labels = h.split(".")
        suffixes = [".".join(labels[i:]) for i in range(len(labels))]
        if any(s in self.blocked for s in suffixes):
            return "", "provedor_ou_excluido"
        if any(s in self.private for s in suffixes):
            return "", "plataforma_compartilhada"
        cut = None
        for i, s in enumerate(suffixes):
            if s in self.exceptions:
                cut = i + 1
                break
            if s in self.suffix or (i + 1 < len(labels) and suffixes[i + 1] in self.wildcard):
                cut = i
                break
        if not cut:
            return "", "dominio_invalido"
        if labels[cut-1] in PROVIDER_STEMS:
            return "", "provedor_ou_variacao"
        return suffixes[cut-1], ""


def company_key(name):
    return re.sub("[^a-z0-9]", "", unicodedata.normalize("NFKD", name.lower()).encode("ascii", "ignore").decode())


def psql(sql):
    command = ["docker", "exec", "-i", "apito-crm-postgres", "sh", "-c",
               'exec psql -XqAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"']
    return subprocess.run(command, input=sql, capture_output=True, text=True,
                          encoding="utf-8", check=True).stdout


CURRENT = """
WITH brands AS MATERIALIZED (
 SELECT convert_from(pg_catalog.lo_get(m.oid),'UTF8')::jsonb->'entries' entries
 FROM pg_catalog.pg_largeobject_metadata m JOIN pg_catalog.pg_description d
 ON d.objoid=m.oid AND d.classoid='pg_catalog.pg_largeobject'::regclass AND d.objsubid=0
 WHERE d.description='crm-apito/company-brand-register/v1'
 AND pg_get_userbyid(m.lomowner) IN (current_user,'crm_web_vps')
)
SELECT 'c' k,id,email v,company::text l FROM public.contacts UNION ALL
SELECT 'e',id,name,coalesce(nullif(to_jsonb(c)->>'website',''),'https://'||(brands.entries->c.id::text->>'domain'))
FROM public.companies c LEFT JOIN brands ON true UNION ALL
SELECT 'a',contact_id,json_agg(DISTINCT email ORDER BY email)::text,NULL FROM (
 SELECT s.contact_id,e.original_email email FROM crm_enrichment.crm_contact_sources s
 JOIN address_book.emails e ON e.contact_id::text=s.source_id WHERE s.source='iphone'
 UNION ALL SELECT s.contact_id,v FROM crm_enrichment.crm_contact_sources s
 JOIN kommo_import.contacts c ON c.source_id=s.source_id AND c.account_id=32793883
 CROSS JOIN LATERAL jsonb_array_elements_text(c.emails) v WHERE s.source='kommo'
 UNION ALL SELECT s.contact_id,v FROM crm_enrichment.crm_contact_sources s
 JOIN crm_enrichment.meeventos_crosswalk m ON m.source_id=s.source_id AND m.source_type='clients'
 AND m.account_id=32793883 CROSS JOIN LATERAL (VALUES(m.attributes->>'email'),(m.attributes->>'email2')) e(v)
 WHERE s.source='clients'
) alternate WHERE nullif(trim(email),'') IS NOT NULL GROUP BY contact_id
"""
SNAPSHOT = "SELECT json_build_array(k,id,v,l) FROM ("+CURRENT+") t ORDER BY k,id;"


def analyze(records, rules):
    companies = {}
    known = collections.defaultdict(set)
    existing_links = collections.defaultdict(set)
    names = collections.defaultdict(set)
    contacts = []
    all_domains = collections.defaultdict(set)
    alternate = {ident:json.loads(value) for kind,ident,value,_ in records if kind=="a"}
    for kind, ident, value, link in records:
        if kind=="a":
            continue
        if kind == "e":
            companies[ident] = link
            names[company_key(value)].add(ident)
            for candidate in (value, link):
                if not candidate:
                    continue
                try:
                    url = urlsplit(candidate if "://" in candidate else "//" + candidate)
                    dom, _ = rules.classify(url.hostname or "")
                except ValueError:
                    continue
                if dom:
                    known[dom].add(ident)
            continue
        reasons, domains = set(), set()
        tokens = [token for email in [value,*alternate.get(ident,[])] for token in re.split(r"[,;]",email or "")]
        for token in tokens:
            token = token.strip()
            if not token:
                continue
            match = EMAIL.fullmatch(token)
            dom, reason = rules.classify(match[1]) if match else ("", "email_invalido")
            if dom:
                domains.add(dom)
                all_domains[company_key(dom.split(".")[0])].add(dom)
            elif reason:
                reasons.add(reason)
        if link and len(domains) == 1:
            existing_links[next(iter(domains))].add(int(link))
        contacts.append((ident, link, domains, reasons))

    result = []
    for ident, link, domains, reasons in contacts:
        domain = next(iter(domains)) if len(domains) == 1 else ""
        target = None
        if not domain or (reasons - {"provedor_ou_excluido","provedor_ou_variacao"}):
            status = ("revisar_multiplos" if domains else
                      sorted(reasons)[0] if reasons else "sem_email")
        else:
            key = company_key(domain.split(".")[0])
            possible = known[domain].copy()
            if len(all_domains[key]) == 1:
                possible.update(names[key])
            if existing_links[domain] - possible:
                status = "revisar_vinculo_preexistente"
            elif len(possible) > 1 or (len(all_domains[key]) > 1 and names[key] and not possible):
                status = "revisar_empresas"
            elif possible:
                target = next(iter(possible))
                site = companies[target]
                try:
                    site_domain = rules.classify(urlsplit(site if "://" in site else "//"+site).hostname or "")[0] if site else ""
                except ValueError:
                    site_domain = ""
                status = "revisar_site" if site and site_domain != domain else "vincular"
            else:
                status = "vincular"
        if link and not status.startswith("revisar"):
            status = "ja_vinculado"
        result.append((ident, domain, target, status))
    return result


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("--apply", action="store_true")
    apply = args.parse_args().apply
    rules = Rules()
    snapshot = psql(SNAPSHOT)
    records = [json.loads(s) for s in snapshot.splitlines()]
    decisions = analyze(records, rules)
    summary = dict(collections.Counter(row[3] for row in decisions))
    new_companies = {dom for _,dom,target,status in decisions if status=="vincular" and target is None}
    linked_before=sum(1 for k,_,_,link in records if k=="c" and link)
    companies_before=sum(1 for k,*_ in records if k=="e")
    print(json.dumps({"contatos": len(decisions), "status": summary, "listas_sha256": rules.hashes,
                      "quantidade_regras": rules.counts,"vinculados_antes": linked_before,
                      "vinculados_previstos": linked_before+summary.get("vincular",0),
                      "empresas_antes": companies_before,"empresas_novas_previstas":len(new_companies)}))
    if not apply:
        return
    # Validate the exact snapshot under lock before accepting any inferred links.
    rows = io.StringIO()
    writer = csv.writer(rows, lineterminator="\n")
    writer.writerows(records)
    source_copy = rows.getvalue()
    rows = io.StringIO()
    csv.writer(rows, lineterminator="\n").writerows(decisions)
    plan_copy = rows.getvalue()
    query = """BEGIN;
SET LOCAL lock_timeout='10s';
SELECT pg_advisory_xact_lock(hashtext('crm_empresa_por_email'));
LOCK TABLE public.contacts,public.companies IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE inputs(k text,id integer,v text,l text) ON COMMIT DROP;
COPY inputs FROM STDIN WITH (FORMAT csv);
""" + source_copy + """\\.
DO $$ BEGIN IF EXISTS (
 WITH actual AS (""" + CURRENT + """) SELECT 1 FROM actual FULL JOIN inputs USING(k,id)
 WHERE actual.id IS NULL OR inputs.id IS NULL OR coalesce(actual.v,'')<>coalesce(inputs.v,'')
 OR coalesce(actual.l,'')<>coalesce(inputs.l,'')
) THEN RAISE EXCEPTION 'Base alterada durante análise. Execute novamente.'; END IF; END $$;
CREATE TEMP TABLE plan(contact_id integer primary key,domain text,target integer,status text) ON COMMIT DROP;
COPY plan FROM STDIN WITH (FORMAT csv);
""" + plan_copy + """\\.
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS website text;
CREATE SCHEMA IF NOT EXISTS crm_enrichment;
CREATE TABLE IF NOT EXISTS crm_enrichment.email_company_events (
 id bigint generated by default as identity primary key,linked_at timestamptz not null default now(),
 contact_id integer not null,company_id integer not null,domain text not null);
CREATE TABLE IF NOT EXISTS crm_enrichment.email_company_review (
 contact_id integer primary key,domain text,reason text not null);
DELETE FROM crm_enrichment.email_company_review r WHERE NOT EXISTS (
 SELECT 1 FROM plan p WHERE p.contact_id=r.contact_id AND p.status LIKE 'revisar%');
INSERT INTO crm_enrichment.email_company_review SELECT contact_id,domain,status FROM plan WHERE status LIKE 'revisar%'
ON CONFLICT(contact_id) DO UPDATE SET domain=excluded.domain,reason=excluded.reason;
WITH created AS (
 INSERT INTO public.companies(name,city,website)
 SELECT DISTINCT domain,'','https://'||domain FROM plan WHERE status='vincular' AND target IS NULL
 RETURNING id,name
) UPDATE plan SET target=created.id FROM created WHERE plan.domain=created.name AND plan.status='vincular';
WITH sites AS (
 SELECT target,min(domain) domain FROM plan WHERE status IN ('vincular','ja_vinculado') AND target IS NOT NULL
 GROUP BY target HAVING count(distinct domain)=1
) UPDATE public.companies c SET website='https://'||s.domain FROM sites s
WHERE c.id=s.target AND nullif(trim(c.website),'') IS NULL;
WITH updated AS (
 UPDATE public.contacts c SET company=p.target FROM plan p
 WHERE c.id=p.contact_id AND c.company IS NULL AND p.status='vincular' AND p.target IS NOT NULL
 RETURNING c.id,c.company,p.domain
) INSERT INTO crm_enrichment.email_company_events(contact_id,company_id,domain) SELECT * FROM updated;
SELECT json_build_object('vinculados',count(company),'sem_empresa',count(*)-count(company),
 'total',count(*),'empresas',(SELECT count(*) FROM public.companies)) FROM public.contacts;
COMMIT;
"""
    try:
        print(psql(query).strip())
    except subprocess.CalledProcessError as err:
        # COPY diagnostics can contain field values. Emit only the diagnostic headline.
        print(next((s for s in err.stderr.splitlines() if s.startswith("ERROR:")), "Falha na transação"))
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
