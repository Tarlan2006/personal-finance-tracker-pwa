"""Generate a public, synthetic Freedom PDF. Requires reportlab and a Cyrillic TTF."""
from pathlib import Path
import os,textwrap
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(TTFont('Fixture',os.environ.get('FIXTURE_FONT','C:/Windows/Fonts/arial.ttf')))
path=Path(__file__).parent/'freedom'/'statement.pdf';path.parent.mkdir(exist_ok=True)
c=canvas.Canvas(str(path),pagesize=(612,792),invariant=1)
c.setTitle('SYNTHETIC FREEDOM TEST ONLY');c.setAuthor('Qarjy synthetic fixtures')
c.setFont('Fixture',12);c.drawString(56.7,730,'FREEDOM — SYNTHETIC TEST ONLY')
c.setFont('Fixture',10);c.drawString(56.7,680,'No real names, accounts, cards or payments.');c.showPage()
cols=[56.7,131.5,256.2,306,380.8,555.3]
def row(top,height,date,amount,currency,operation,details):
 c.setStrokeColorRGB(.7,.7,.7);c.setLineWidth(.5)
 for left,right in zip(cols,cols[1:]):
  c.line(left,top,right,top);c.line(left,top-height,right,top-height)
  c.line(left,top,left,top-height)
 c.line(cols[-1],top,cols[-1],top-height)
 c.setFont('Fixture',9)
 for i,text in enumerate([date,amount,currency,operation,details]):
  lines=text.split('\n');y=top-height/2+(len(lines)-1)*11/2-3
  for line in lines:
   if i==1:c.drawRightString(250,y,line)
   else:c.drawString([61,140,264.41,309.41,385][i],y,line)
   y-=11
c.setFont('Fixture',9);c.drawString(56.7,750,'FREEDOM SYNTHETIC')
for text,x in [('Дата',83.25),('Сумма',222.68),('Валюта',264.41),('Операция',321.41),('Детали',451.76)]:c.drawString(x,630.08,text)
for left,right in zip(cols,cols[1:]):c.line(left,643.28,right,643.28);c.line(left,623.81,right,623.81)
top=623.81
row(top,35,'01.11.2026','-123.45 ₸','KZT','Покупка','TEST SHOP');top-=35
row(top,50,'02.11.2026','+678.90 ₸','KZT','Пополнение','Перевод средств.\nОтправитель: TEST SENDER\nCONTINUATION');top-=50
row(top,38,'03.11.2026','-432.10 ₸','KZT','Сумма в\nобработке','TEST PENDING');top-=38
row(top,35,'03.11.2026','-9.99 $','USD','Покупка','TEST FOREIGN');top-=35
row(top,40,'03.11.2026','-77.65 ₸','KZT','Перевод','Перевод между своими\nсчетами');top-=40
long='TEST LONG DESCRIPTION '+('SYNTHETIC DETAIL '*20).strip()
row(top,180,'04.11.2026','-88.76 ₸','KZT','Покупка','\n'.join(textwrap.wrap(long,29)))
row(130,25,'','','','','Перевод средств.\nОтправитель:')
c.showPage()
# A continuation page without repeated headers, as observed in the owner sample.
row(735.3,45,'05.11.2026','+54.32 ₸','KZT','Пополнение','TEST SPLIT SENDER')
c.save()

