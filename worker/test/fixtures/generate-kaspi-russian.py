"""Public synthetic Kaspi Russian layouts; no private pages or metadata copied."""
from pathlib import Path
import os
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(TTFont('Fixture',os.environ.get('FIXTURE_FONT','C:/Windows/Fonts/arial.ttf')))
root=Path(__file__).parent/'kaspi'

def make(path,verified):
 c=canvas.Canvas(str(path),pagesize=(595.3,841.9),invariant=1)
 c.setTitle('SYNTHETIC KASPI RUSSIAN TEST ONLY');c.setAuthor('Qarjy synthetic fixtures')
 c.setFont('Fixture',12);c.drawString(59,760,'KASPI GOLD - SYNTHETIC TEST ONLY')
 c.setFont('Fixture',10);c.drawString(59,730,'No real names, accounts, cards or payments.');c.showPage()
 def row(y,date,amount,kind,details,x=243):
  c.setFont('Fixture',9)
  for left,text in [(59,date),(110,amount),(x,kind),(311.5,details)]:c.drawString(left,y,text)
 if verified:
  c.setFont('Fixture',10);c.drawString(59,500,'SYNTHETIC SERVICE SECTION')
  c.setFont('Fixture',9)
  for label,x in [('Дата',59),('Сумма',133.6),('Операция',243),('Детали',311.5)]:c.drawString(x,333.7,label)
 row(307,'01.11.26','- 111,11 ₸','Покупка','SYNTHETIC SHOP')
 row(281,'02.11.26','+ 222,22 ₸','Пополнение','SYNTHETIC SENDER',230)
 row(255,'03.11.26','- 333,33 ₸','Перевод на карту','SYNTHETIC RECEIVER',202)
 c.drawString(311.5,243,'CONTINUATION')
 row(220,'04.11.26','- 444,44 ₸','Ожидает','SYNTHETIC PENDING')
 c.drawString(59,190,'SYNTHETIC SERVICE FOOTER')
 c.showPage()
 row(780,'06.11.26','- 666,66 ₸','Покупка','PAGE TWO SHOP')
 c.drawString(311.5,768,'CONTINUED')
 row(742,'07.11.26','- 777,77 ₸','Отклонена','SYNTHETIC REJECTED')
 c.drawString(59,710,'SYNTHETIC FOOTER')
 c.save()
make(root/'gold-russian.pdf',True)
make(root/'gold-russian-unverified.pdf',False)
